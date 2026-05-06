"""Hot-patch box 098015 fix: dailyOnline.ts + realSales.ts on production."""
import sys
import paramiko
sys.stdout.reconfigure(encoding='utf-8')
HOST = "74.208.78.255"; USER = "root"; PASS = "ymyCBoaPmIhVcI5"

def ssh_run(c, cmd, timeout=120):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.channel.recv_exit_status(), so.read().decode("utf-8", errors="replace"), se.read().decode("utf-8", errors="replace")

LOCAL_DAILY = r"C:\Users\nishn\Desktop\Future Foods\Portal\Storv_POS_All\Storv_POS_All\backend\src\controllers\lottery\dailyOnline.ts"
LOCAL_REAL  = r"C:\Users\nishn\Desktop\Future Foods\Portal\Storv_POS_All\Storv_POS_All\backend\src\services\lottery\reporting\realSales.ts"
REMOTE_DAILY = "/var/www/Storv_POS_All/backend/src/controllers/lottery/dailyOnline.ts"
REMOTE_REAL  = "/var/www/Storv_POS_All/backend/src/services/lottery/reporting/realSales.ts"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=15, look_for_keys=False, allow_agent=False)

# Backup originals first
print("=== Backing up originals ===")
ts = "20260506-hotpatch"
rc, out, err = ssh_run(c, f"cp {REMOTE_DAILY} {REMOTE_DAILY}.bak.{ts} && cp {REMOTE_REAL} {REMOTE_REAL}.bak.{ts} && ls -la {REMOTE_DAILY}.bak.{ts} {REMOTE_REAL}.bak.{ts}")
print(out)

# Upload via SFTP
print("\n=== Uploading patched files ===")
sftp = c.open_sftp()
sftp.put(LOCAL_DAILY, REMOTE_DAILY)
print(f"Uploaded {REMOTE_DAILY}")
sftp.put(LOCAL_REAL, REMOTE_REAL)
print(f"Uploaded {REMOTE_REAL}")
sftp.close()

# Fix ownership
rc, out, err = ssh_run(c, f"chown github-runner:github-runner {REMOTE_DAILY} {REMOTE_REAL} && ls -la {REMOTE_DAILY} {REMOTE_REAL}")
print(out)

# Restart backend (use github-runner since it owns PM2)
print("\n=== Restarting api-pos ===")
rc, out, err = ssh_run(c, """
sudo -u github-runner bash -c '
  export PATH=/usr/local/bin:/usr/bin:/bin:/home/github-runner/.nvm/versions/node/v20.20.1/bin:$PATH
  pm2 restart api-pos --update-env 2>&1 | tail -20
'
""", timeout=60)
print(out)

# Wait and check status
import time
time.sleep(3)
rc, out, err = ssh_run(c, """
sudo -u github-runner bash -c '
  export PATH=/usr/local/bin:/usr/bin:/bin:/home/github-runner/.nvm/versions/node/v20.20.1/bin:$PATH
  pm2 list 2>&1 | grep -E "(api-pos|name|---)"
'
""")
print(out)

c.close()
