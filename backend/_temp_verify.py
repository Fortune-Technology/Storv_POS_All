"""Verify box 098015 May 6 now shows correct numbers."""
import sys
import paramiko
import time

sys.stdout.reconfigure(encoding='utf-8')
HOST = "74.208.78.255"; USER = "root"; PASS = "ymyCBoaPmIhVcI5"; DB = "storeveu_pos"
ORG_ID = "cmnz5r0fb000abyhu23xyskkg"; STORE_ID = "cmnz5sazz000cbyhu5k3cbszz"

def ssh_run(c, cmd, timeout=60):
    si, so, se = c.exec_command(cmd, timeout=timeout)
    return so.channel.recv_exit_status(), so.read().decode("utf-8", errors="replace"), se.read().decode("utf-8", errors="replace")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=15, look_for_keys=False, allow_agent=False)

# Wait for backend ready
print("=== Waiting 5s for backend ===")
time.sleep(5)

# Sign JWT
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

print("=== getCounterSnapshot for May 6 (box 098015) — POST-FIX ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/counter-snapshot?date=2026-05-06&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
import json
try:
    d = json.loads(out)
    boxes = d.get('boxes', [])
    for b in boxes:
        if 'cmobjxcbu1w3ltznqepzpbqgf' in str(b.get('id', '')):
            print(json.dumps({k: v for k, v in b.items() if k in ('id','boxNumber','status','currentTicket','lastShiftEndTicket','startTicket','yesterdayClose','todayClose','openingTicket')}, indent=2, default=str))
            break
except Exception as e:
    print(f"Err: {e}")
    print(out[:500])

print("\n=== daily-inventory for May 6 — POST-FIX ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/daily-inventory?date=2026-05-06&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
try:
    d = json.loads(out)
    data = d.get('data', d)
    print(f"sold: ${data.get('sold')} | source: {data.get('salesSource')} | unreported: ${data.get('unreported')}")
    bb = data.get('boxBreakdown', [])
    box = next((b for b in bb if b.get('boxNumber') == '098015'), None)
    if box:
        print(f"box 098015 contribution: {json.dumps(box, default=str)}")
    else:
        print("✓ box 098015 NOT in boxBreakdown for May 6 (good — no phantom sale)")
except Exception as e:
    print(f"Err: {e}")
    print(out[:500])

print("\n=== daily-inventory for May 5 — POST-FIX (sanity) ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/daily-inventory?date=2026-05-05&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
try:
    d = json.loads(out)
    data = d.get('data', d)
    print(f"sold: ${data.get('sold')} | source: {data.get('salesSource')} | unreported: ${data.get('unreported')}")
except Exception as e:
    print(f"Err: {e}")

print("\n=== daily-inventory for May 4 — POST-FIX (sanity, should still be ~$2995) ===")
rc, out, err = ssh_run(c, f"""curl -sS 'http://localhost:5002/api/lottery/daily-inventory?date=2026-05-04&storeId={STORE_ID}' -H 'Authorization: Bearer {token}' -H 'X-Store-Id: {STORE_ID}' 2>&1""", timeout=30)
try:
    d = json.loads(out)
    data = d.get('data', d)
    print(f"sold: ${data.get('sold')} | source: {data.get('salesSource')} | unreported: ${data.get('unreported')}")
except Exception as e:
    print(f"Err: {e}")

c.close()
