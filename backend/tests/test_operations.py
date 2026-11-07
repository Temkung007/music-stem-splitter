"""Daily allowance concurrency/refunds and verified backup corruption detection."""
import importlib.util
import json
import os
import sqlite3
import tempfile
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from test_api import HttpHarness, audio_bytes
from test_worker_jobs import WorkerQueueHelpers


class DailyAllowanceTests(WorkerQueueHelpers, HttpHarness):
    extra_environment = {"STEMORA_WORKER_ENABLED":"1", "DAILY_PROCESSING_MINUTES":"1"}

    def setUp(self):
        # Each test has its own account; no daily quota or queued work can leak across tests.
        from urllib.request import build_opener, HTTPCookieProcessor
        import http.cookiejar
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        _, raw, _ = self.request('/api/auth/register', json_body={'email':uuid.uuid4().hex+'@test.example','name':'Quota check','password':'quota-test-password'})
        self.account = json.loads(raw)
        self.test_user_ids.append(self.account['id'])

    def submit_duration(self, seconds, request_id=None):
        return self.request('/api/separate', fields={'engine':'worker','stems_mode':'2stems','storage_mode':'download', **({'request_id':request_id} if request_id else {})}, filename='Quota.wav',content=audio_bytes(seconds))

    def test_concurrent_reservations_and_pending_cancellation_refund(self):
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:self.submit_duration(40),range(2)))
        self.assertEqual(sorted(x[0] for x in results),[202,429])
        task=json.loads(next(x[1] for x in results if x[0]==202))['task_id']
        self.assertEqual(self.request('/api/tasks/'+task+'/cancel',method='POST')[0],200)
        self.assertEqual(json.loads(self.request('/api/processing-allowance')[1])['used_minutes'],0)

    def test_duplicate_reservation_is_not_charged_twice_and_active_cancel_is_charged(self):
        ident=str(uuid.uuid4())
        first=self.submit_duration(30,ident); self.assertEqual(first[0],202,first[1])
        self.assertEqual(self.submit_duration(30,ident)[0],202)
        self.assertEqual(json.loads(self.request('/api/processing-allowance')[1])['used_minutes'],.5)
        task=json.loads(first[1])['task_id'];_,token=self.worker(); job=self.api('/claim',token,{})[1]['job']
        self.assertEqual(job['id'],task)
        self.request('/api/tasks/'+task+'/cancel',method='POST')
        self.assertEqual(json.loads(self.request('/api/processing-allowance')[1])['used_minutes'],.5)

    def test_infrastructure_failure_refunds_and_privacy(self):
        code,raw,_=self.submit_duration(30);self.assertEqual(code,202)
        task=json.loads(raw)['task_id']
        self.db("UPDATE stem_jobs SET status='processing',attempts=3,lease_until=0 WHERE id=?",(task,))
        _,token=self.worker();self.api('/claim',token,{})
        self.assertEqual(json.loads(self.request('/api/processing-allowance')[1])['used_minutes'],0)
        from urllib.request import build_opener
        self.assertEqual(self.request('/api/processing-allowance',opener=build_opener())[0],401)


class BackupVerificationTests(unittest.TestCase):
    def test_restore_copy_and_reject_corruption_and_missing_objects(self):
        module=Path(__file__).resolve().parents[2]/'scripts/verify_backup.py'
        spec=importlib.util.spec_from_file_location('verify_ops_backup',module);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'objects/users/test').mkdir(parents=True)
            obj=root/'objects/users/test/song.wav';obj.write_bytes(b'RIFF-test')
            with sqlite3.connect(root/'workspace.sqlite3') as db:
                db.executescript('CREATE TABLE tracks(object_key TEXT);CREATE TABLE assets(object_key TEXT);')
                db.execute("INSERT INTO tracks VALUES('users/test/song.wav')")
            manifest={'version':1,'objects':1,'files':{str(p.relative_to(root)):v.digest(p) for p in root.rglob('*') if p.is_file()}}
            (root/'manifest.json').write_text(json.dumps(manifest));self.assertEqual(v.verify(root)['objects'],1)
            obj.write_bytes(b'corrupted')
            with self.assertRaises(ValueError):v.verify(root)
            obj.unlink()
            with self.assertRaises(ValueError):v.verify(root)

class HealthAndBoundaryTests(unittest.TestCase):
    def test_thai_midnight_rollover(self):
        from processing_quota import limits
        with patch.dict(os.environ, {'DAILY_PROCESSING_MINUTES':'60','PROCESSING_QUOTA_TIMEZONE':'Asia/Bangkok'}):
            self.assertEqual(limits(datetime(2026,11,3,16,59,tzinfo=timezone.utc))[0],'2026-11-03')
            self.assertEqual(limits(datetime(2026,11,3,17,0,tzinfo=timezone.utc))[0],'2026-11-04')

    def test_operator_alerts_are_actionable_without_idle_machine_false_alarm(self):
        from operations import evaluate
        data={'api':True,'database':True,'storage':True,'backup_verified':True,'backup_at':100000,'disk_percent':30,'waiting':0,'workers_online':0}
        self.assertEqual(evaluate(data,now=100001),[])
        self.assertEqual(set(evaluate({**data,'waiting':1,'oldest_wait':901,'disk_percent':86,'backup_failed_at':100001},now=100002)),{'workers','queue','disk','backup'})
