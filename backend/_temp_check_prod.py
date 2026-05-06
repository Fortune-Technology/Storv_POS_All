"""Check production lottery file structure."""
import sys
import paramiko
sys.stdout.reconfigure(encoding='utf-8')
HOST = "74.208.78.255"; USER = "root"; PASS = "ymyCBoaPmIhVcI5"

def ssh_run(c, cmd, timeout=60):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.channel.recv_exit_status(), so.read().decode("utf-8", errors="replace"), se.read().decode("utf-8", errors="replace")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=15, look_for_keys=False, allow_agent=False)

print("=== Lottery folder structure on prod ===")
rc, out, err = ssh_run(c, "ls -la /var/www/Storv_POS_All/backend/src/controllers/lottery/ 2>&1; echo '---'; ls -la /var/www/Storv_POS_All/backend/src/services/lottery/reporting/ 2>&1")
print(out)

print("\n=== Check if lotteryController is shim or full file ===")
rc, out, err = ssh_run(c, "wc -l /var/www/Storv_POS_All/backend/src/controllers/lotteryController.ts 2>&1; head -5 /var/www/Storv_POS_All/backend/src/controllers/lotteryController.ts 2>&1")
print(out)

print("\n=== Check git log on prod ===")
rc, out, err = ssh_run(c, "cd /var/www/Storv_POS_All && git log --oneline -10 2>&1")
print(out)

c.close()
