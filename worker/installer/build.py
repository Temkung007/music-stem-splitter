"""Build an offline Apple Silicon installer without operator credentials."""
import json,os,shutil,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2];build=root/'worker/build/installer';payload=build/'payload';bundle=payload/'Library/Application Support/STEMORA Installer'
if build.exists():shutil.rmtree(build)
bundle.mkdir(parents=True)
support=Path.home()/'Library/Application Support/STEMORA Worker'
for name in ('runtime','runtime-mlx','runtime-vocals'):
 shutil.copytree(support/name,bundle/name,symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 for exe in ('python','python3','python3.12'):
  p=bundle/name/'bin'/exe;p.unlink(missing_ok=True);p.symlink_to('../../python/bin/python3.12')
 (bundle/name/'pyvenv.cfg').write_text('home = ../python/bin\ninclude-system-site-packages = false\n')
shutil.copytree((support/'runtime/bin/python').resolve().parents[1],bundle/'python',symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
shutil.copytree(Path.home()/'.cache/demucs-mlx',bundle/'models',ignore=shutil.ignore_patterns('*.lock','*.tmp'))
shutil.copytree(support/'models-vocals',bundle/'models-vocals',ignore=shutil.ignore_patterns('*.lock','*.tmp','*.download'))
shutil.copy2(root/'worker/download_vocals.py',bundle/'download_vocals.py')
shutil.copytree(Path.home()/'Applications/STEMORA Worker.app',bundle/'STEMORA Worker.app')
shutil.copy2(root/'worker/installer/setup.py',bundle/'setup.py')
# Bundle FFmpeg and its Homebrew dependencies with relative loader paths.
ff=bundle/'ffmpeg';ff.mkdir();seen={}
def collect(original):
 original=Path(original).resolve()
 if str(original) in seen:return seen[str(original)]
 target=ff/original.name;seen[str(original)]=target;shutil.copy2(original,target);target.chmod(0o755)
 dependencies=subprocess.check_output(['otool','-L',str(original)],text=True).splitlines()[1:]
 for line in dependencies:
  dep=line.strip().split(' (')[0]
  if dep.startswith('/opt/homebrew/'):
   dest=collect(dep)
   subprocess.run(['install_name_tool','-change',dep,'@loader_path/'+dest.name,str(target)],check=True,stderr=subprocess.DEVNULL)
 subprocess.run(['codesign','--force','--sign','-',str(target)],check=True,stderr=subprocess.DEVNULL)
 return target
collect('/opt/homebrew/bin/ffmpeg')
# No configuration, token, logs, job results, or user music enter this package.
assert not (bundle/'config.json').exists()
assert not (bundle/'enrollment.json').exists()
assert not (bundle/'control.json').exists()
scripts=build/'scripts';scripts.mkdir()
post=scripts/'postinstall';post.write_text('''#!/bin/bash
set -euo pipefail
USER_NAME=$(/usr/bin/stat -f %Su /dev/console)
if [[ "$USER_NAME" == "root" || "$USER_NAME" == "loginwindow" ]]; then
 echo "Sign into your Mac before installing STEMORA Worker." >&2; exit 1
fi
/usr/bin/sudo -H -u "$USER_NAME" "/Library/Application Support/STEMORA Installer/python/bin/python3.12" "/Library/Application Support/STEMORA Installer/setup.py"
''');post.chmod(0o755)
subprocess.run([str(bundle/'ffmpeg/ffmpeg'),'-version'],check=True,stdout=subprocess.DEVNULL)
for runtime,module in [('runtime','torch,demucs'),('runtime-mlx','mlx.core,demucs_mlx'),('runtime-vocals','mlx_audio.sts.models.mel_roformer,soundfile')]:
 subprocess.run([str(bundle/'python/bin/python3.12'),'-c','import '+module],env={**os.environ,'PYTHONPATH':str(bundle/runtime/'lib/python3.12/site-packages')},check=True)
component=build/'components.plist'
import plistlib
component.write_bytes(plistlib.dumps([{'RootRelativeBundlePath':'Library/Application Support/STEMORA Installer/STEMORA Worker.app','BundleIsRelocatable':False,'BundleHasStrictIdentifier':True,'BundleOverwriteAction':'upgrade'}]))
version=plistlib.loads((root/'worker/build/STEMORA Worker.app/Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
output=root/f'dist/STEMORA-Worker-Apple-Silicon-v{version}.pkg'
output.parent.mkdir(exist_ok=True)
subprocess.run(['pkgbuild','--root',str(payload),'--component-plist',str(component),'--scripts',str(scripts),'--identifier','com.mydjplus.stemora.worker.installer','--version',version,'--install-location','/',str(output)],check=True)
print(output)
