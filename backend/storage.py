"""Private object storage, using the same contract for development and self-hosted S3."""

import os
import shutil
import uuid
from pathlib import Path

import boto3
from botocore.config import Config
from database import DATA


class ObjectStorage:
    def __init__(self):
        self.driver = os.environ.get("STORAGE_DRIVER", "local")
        self.root = DATA / "objects"
        self.cache = DATA / "cache"
        self.root.mkdir(exist_ok=True)
        self.cache.mkdir(exist_ok=True)
        self.bucket = os.environ.get("S3_BUCKET", "stemora")
        if self.driver not in {"local", "s3"}:
            raise RuntimeError("STORAGE_DRIVER must be local or s3")
        self.client = None
        if self.driver == "s3":
            self.client = boto3.client(
                "s3",
                endpoint_url=os.environ["S3_ENDPOINT"],
                aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                aws_secret_access_key=os.environ["S3_SECRET_KEY"],
                region_name=os.environ.get("S3_REGION", "garage"),
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                    retries={"max_attempts": 3},
                    connect_timeout=10,
                    read_timeout=90,
                ),
            )

    def local_path(self, key):
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("Invalid object key")
        return path

    def put(self, path: Path, key: str):
        if self.client:
            self.client.upload_file(str(path), self.bucket, key)
        else:
            destination = self.local_path(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + f".{uuid.uuid4()}.tmp")
            shutil.copyfile(path, temporary)
            temporary.replace(destination)

    def materialize(self, key: str):
        if not self.client:
            path = self.local_path(key)
            if not path.is_file():
                raise FileNotFoundError(key)
            return path
        import hashlib

        path = self.cache / hashlib.sha256(key.encode()).hexdigest()
        if not path.is_file():
            temporary = path.with_name(path.name + f".{uuid.uuid4()}.tmp")
            try:
                self.client.download_file(self.bucket, key, str(temporary))
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        return path

    def delete(self, key):
        if self.client:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        else:
            self.local_path(key).unlink(missing_ok=True)

    def health(self):
        if self.client:
            self.client.head_bucket(Bucket=self.bucket)
        return {"driver": self.driver, "ready": True}


storage = ObjectStorage()
