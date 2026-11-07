"""Offline per-user setup; run as the desktop user, never as root."""
import hashlib,json,os,plistlib,shutil,subprocess,sys,uuid,secrets,socket
from pathlib import Path
assert os.getuid()!=0, 'Run setup as the Mac user'
source=Path(__file__).resolve().parent
support=Path.home()/'Library/Application Support/STEMORA Worker'
support.mkdir(parents=True,exist_ok=True,mode=0o700)
for name in ('python','runtime','runtime-mlx','ffmpeg'):
 target=support/name
 if not target.exists():shutil.copytree(source/name,target,symlinks=True)
# Install this engine atomically, including on upgrades from Demucs-only workers.
name='runtime-vocals'; target=support/name
staged=support/('install-staging-'+uuid.uuid4().hex)
shutil.copytree(source/name,staged,symlinks=True)
if target.exists():
 backup=support/'build-backups'/('vocal-runtime-'+uuid.uuid4().hex);backup.parent.mkdir(exist_ok=True);target.rename(backup)
staged.rename(target)
for name in ('runtime','runtime-mlx','runtime-vocals'):
 p=support/name/'pyvenv.cfg'
 p.write_text('home = '+str(support/'python/bin')+'\ninclude-system-site-packages = false\nversion = 3.12.13\n')
 for executable in ('python','python3','python3.12'):
  p=support/name/'bin'/executable
  p.unlink(missing_ok=True);p.symlink_to('../../python/bin/python3.12')
models=Path.home()/'.cache/demucs-mlx';models.mkdir(parents=True,exist_ok=True)
for p in (source/'models').rglob('*'):
 if p.is_file():
  dest=models/p.relative_to(source/'models');dest.parent.mkdir(parents=True,exist_ok=True)
  if not dest.exists():shutil.copy2(p,dest)
from download_vocals import FILES
vocal_models=support/'models-vocals/kim-vocal-2';vocal_models.mkdir(parents=True,exist_ok=True)
for name,digest in FILES.items():
 p=source/'models-vocals/kim-vocal-2'/name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest, 'Damaged vocal model in installer'
 dest=vocal_models/name
 if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest()!=digest:
  temp=dest.with_suffix('.install');shutil.copy2(p,temp);temp.replace(dest)
config=support/'config.json'
existing=config.exists()
d=json.loads(config.read_text()) if existing else {'server_url':'https://stemora.mydjplus.com','origin_ip':'143.198.204.118','id':str(uuid.uuid4()),'token':secrets.token_urlsafe(48)}
d.update(python=str(support/'runtime/bin/python'),mlx_python=str(support/'runtime-mlx/bin/python'),ffmpeg=str(support/'ffmpeg/ffmpeg'),backend='mlx',device='cpu',vocal_python=str(support/'runtime-vocals/bin/python'),vocal_weights=str(vocal_models))
config.write_text(json.dumps(d,indent=2)+'\n');config.chmod(0o600)
if not existing:
 (support/'control.json').write_text(json.dumps({'paused':True,'parallel_jobs':0,'quality':'high','start_hour':0,'end_hour':0}))
 (support/'control.json').chmod(0o600)
 (support/'enrollment.json').write_text(json.dumps({'id':d['id'],'name':socket.gethostname().removesuffix('.local')[:80],'token_hash':hashlib.sha256(d['token'].encode()).hexdigest()},indent=2))
 (support/'enrollment.json').chmod(0o600)
app=Path.home()/'Applications/STEMORA Worker.app';app.parent.mkdir(exist_ok=True)
if app.exists():
 assert plistlib.loads((app/'Contents/Info.plist').read_bytes())['CFBundleIdentifier']=='com.mydjplus.stemora.worker'
 backup=support/'build-backups'/('installer-'+uuid.uuid4().hex+'.app');backup.parent.mkdir(exist_ok=True);app.rename(backup)
shutil.copytree(source/'STEMORA Worker.app',app,symlinks=True)
for python in (support/'runtime/bin/python',support/'runtime-mlx/bin/python',support/'runtime-vocals/bin/python'):
 subprocess.run([str(python),'-c','import numpy, soundfile'],check=True)
print('Installed STEMORA Worker. Open it from Applications in your home folder.')
if not existing: print('New Mac: enroll enrollment.json with your STEMORA administrator before enabling jobs.')
