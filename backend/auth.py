"""Password hashing, revocable cookie sessions, rate limits and browser CSRF checks."""

import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

from database import INTEGRITY_ERRORS, connect, lock_writes
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth")
COOKIE = "stemora_session"
SESSION_SECONDS = 30 * 86400


def now():
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt.encode(), n=16384, r=8, p=1
    ).hex()
    return f"scrypt${salt}${digest}"


def verify_password(password: str, stored: str):
    try:
        _, salt, _ = stored.split("$")
        return hmac.compare_digest(hash_password(password, salt), stored)
    except ValueError:
        return False


def safe_user(row):
    return {key: row[key] for key in ("id", "email", "name", "created_at")}


def current_user(request: Request):
    token = request.cookies.get(COOKIE, "")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.query_params.get("token", "")
    if not token:
        raise HTTPException(401, "กรุณาเข้าสู่ระบบ")
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        user = db.execute(
            "SELECT u.*, s.expires_at AS session_expires_at FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?",
            (digest, time.time()),
        ).fetchone()
        if user:
            # Sliding session: If session has less than half duration left, automatically renew!
            if user["session_expires_at"] - time.time() < (SESSION_SECONDS / 2):
                db.execute(
                    "UPDATE sessions SET expires_at=? WHERE hash=?",
                    (time.time() + SESSION_SECONDS, digest),
                )
        else:
            user = db.execute(
                "SELECT u.* FROM users u JOIN sync_tokens st ON u.id=st.user_id WHERE st.token_hash=?",
                (digest,),
            ).fetchone()
            if user:
                db.execute(
                    "UPDATE sync_tokens SET last_used_at=? WHERE token_hash=?",
                    (time.time(), digest),
                )
    if not user:
        raise HTTPException(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง")
    return safe_user(user)


def mutation_guard(request: Request):
    if request.headers.get("x-stemora-request") != "1":
        raise HTTPException(403, "คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่")
    origin = request.headers.get("origin")
    allowed = {
        v.rstrip("/")
        for v in os.environ.get(
            "APP_ORIGIN", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    }
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(403, "ไม่อนุญาตคำขอจากเว็บไซต์นี้")


def rate_limit(key, maximum=15):
    with connect() as db:
        lock_writes(db)
        db.execute("DELETE FROM attempts WHERE reset_at<?", (time.time(),))
        row = db.execute("SELECT count FROM attempts WHERE key=?", (key,)).fetchone()
        if row and row[0] >= maximum:
            raise HTTPException(429, "มีคำขอมากเกินไป กรุณาลองใหม่ใน 15 นาที")
        db.execute(
            "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=attempts.count+1",
            (key, time.time() + 900),
        )


def establish(response, user_id, request: Request = None):
    token = secrets.token_urlsafe(48)
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE expires_at<?", (time.time(),))
        db.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                user_id,
                time.time() + SESSION_SECONDS,
            ),
        )
    is_secure = os.environ.get("COOKIE_SECURE", "0") == "1"
    if request is not None:
        proto = request.headers.get("x-forwarded-proto", "").lower()
        if proto == "https" or request.url.scheme == "https":
            is_secure = True
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        path="/",
    )


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    name: str = Field(default="DJ", min_length=1, max_length=60)


def email_address(value):
    value = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise HTTPException(422, "กรุณาระบุอีเมลให้ถูกต้อง")
    return value


@router.post("/register", status_code=201, dependencies=[Depends(mutation_guard)])
def register(body: Credentials, request: Request, response: Response):
    if os.environ.get("ALLOW_REGISTRATION", "1") != "1":
        raise HTTPException(403, "ยังไม่เปิดรับสมาชิกใหม่")
    email = email_address(body.email)
    rate_limit("register:" + (request.client.host if request.client else "local"), 8)
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name.strip() or "DJ",
        "created_at": now(),
    }
    try:
        with connect() as db:
            db.execute(
                "INSERT INTO users VALUES(?,?,?,?,?)",
                (
                    user["id"],
                    email,
                    user["name"],
                    hash_password(body.password),
                    user["created_at"],
                ),
            )
    except INTEGRITY_ERRORS as error:
        raise HTTPException(409, "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ") from error
    establish(response, user["id"], request)
    return user


@router.post("/login", dependencies=[Depends(mutation_guard)])
def login(body: Credentials, request: Request, response: Response):
    email = email_address(body.email)
    rate_limit("login:" + email)
    with connect() as db:
        user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    # Compute a full hash for unknown accounts as well.
    valid = verify_password(
        body.password, user["password"] if user else hash_password("unknown-account")
    )
    if not user or not valid:
        raise HTTPException(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
    establish(response, user["id"], request)
    return safe_user(user)


@router.get("/me")
def me(user=Depends(current_user)):
    return user


@router.post("/logout", dependencies=[Depends(mutation_guard)])
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    with connect() as db:
        db.execute(
            "DELETE FROM sessions WHERE hash=?",
            (hashlib.sha256(token.encode()).hexdigest(),),
        )
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


@router.post("/password", dependencies=[Depends(mutation_guard)])
def password_change(
    body: PasswordChange, request: Request, response: Response, user=Depends(current_user)
):
    with connect() as db:
        stored = db.execute(
            "SELECT password FROM users WHERE id=?", (user["id"],)
        ).fetchone()[0]
        if not verify_password(body.current_password, stored):
            raise HTTPException(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
        db.execute(
            "UPDATE users SET password=? WHERE id=?",
            (hash_password(body.new_password), user["id"]),
        )
        db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    establish(response, user["id"], request)
    return {"ok": True}
