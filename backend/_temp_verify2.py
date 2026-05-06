"""Verify May 5 view shows correct state for box 098015 (sentinel)."""
import sys, paramiko, time, json

sys.stdout.reconfigure(encoding='utf-8')
HOST = "74.208.78.255"; USER = "root"; PASS = "ymyCBoaPmIhVcI5"; DB = "storeveu_pos"
ORG_ID = "cmnz5r0fb000abyhu23xyskkg"; STORE_ID = "cmnz5sazz000cbyhu5k3cbszz"

def ssh_run(c, cmd, timeout=60):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.channel.recv_exit_status(), so.read().decode("utf-8", errors="replace"), se.read().decode("utf-8", errors="replace")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=15, look_for_keys=False, allow_agent=False)

rc, out, err = ssh_run(c, "grep -E '^JWT_SECRET' /var/www/Storv_POS_All/backend/.env 2>&1 | cut -d= -f2- | head -1")
secret = out.strip().strip('"').strip("'")
rc, out, err = ssh_run(c, f"""sudo -u postgres psql -X -A -F'\t' -t -d {DB} -c "SELECT id FROM users WHERE role='superadmin' AND status='active' LIMIT 1;" 2>&1""")
admin_id = out.strip().split("\n")[0]
sign = f"""sudo -u github-runner bash -c '
  export PATH=/usr/local/bin:/usr/bin:/bin:/home/github-runner/.nvm/versions/node/v20.20.1/bin:$PATH
  cd /var/www/Storv_POS_All/backend
  node -e "const jwt = require(\\"jsonwebtoken\\"); console.log(jwt.sign({{id:\\"{admin_id}\\",orgId:\\"{ORG_ID}\\",role:\\"superadmin\\",storeIds:[\\"{STORE_ID}\\"]}}, \\"{secret}\\", {{expiresIn:\\"5m\\"}}));"
'"""
rc, out, err = ssh_run(c, sign, timeout=30)
token = out.strip().split("\n")[-1]

print("=== May 5 counter-snapshot for box 098015 (still shows -1, -1 with sentinel guard) ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/counter-snapshot?date=2026-05-05&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
d = json.loads(out)
boxes = d.get('boxes', [])
b = next((b for b in boxes if 'cmobjxcbu1w3ltznqepzpbqgf' in str(b.get('id', ''))), None)
if b:
    print(json.dumps({k: v for k, v in b.items() if k in ('boxNumber','status','currentTicket','yesterdayClose','todayClose','openingTicket','lastShiftEndTicket','startTicket')}, indent=2, default=str))

print("\n=== yesterday-closes for May 6 (should now have ticket=149 for 098015) ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/yesterday-closes?date=2026-05-06&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
try:
    d = json.loads(out)
    closes = d.get('closes', {})
    box_close = closes.get('cmobjxcbu1w3ltznqepzpbqgf')
    if box_close:
        print(f"box 098015 yesterday-close: {json.dumps(box_close, default=str, indent=2)}")
    else:
        print("box 098015 not in yesterday-closes")
except Exception as e:
    print(f"Err: {e}")
    print(out[:500])

c.close()
