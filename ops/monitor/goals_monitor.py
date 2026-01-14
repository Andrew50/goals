#!/usr/bin/env python3
import os
import sys
import json
import time
import socket
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
import statistics

# Configuration from environment
HOST_URL = os.environ.get("HOST_URL", "localhost")
FE_URL = f"https://{HOST_URL}/"
BE_URL = f"https://{HOST_URL}/api/auth/validate"
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.environ.get("GOALS_SERVER_TELEGRAM_CHAT_ID")
INTERVAL = int(os.environ.get("GOALS_MONITOR_INTERVAL_SECONDS", "60"))
TIMEOUT = int(os.environ.get("GOALS_MONITOR_TIMEOUT_SECONDS", "10"))
RETENTION_DAYS = int(os.environ.get("GOALS_MONITOR_RETENTION_DAYS", "30"))

# Paths
BASE_DIR = os.environ.get("GOALS_MONITOR_BASE_DIR", "/var/lib/goals/monitor")
SAMPLES_FILE = os.path.join(BASE_DIR, "samples.jsonl")
STATE_FILE = os.path.join(BASE_DIR, "state.json")

# Ensure base dir exists
os.makedirs(BASE_DIR, exist_ok=True)

def get_resource_metrics():
    metrics = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": 0.0,
        "mem_percent": 0.0,
        "disk_percent": 0.0,
        "load_avg": [0.0, 0.0, 0.0]
    }
    
    # Load Avg
    try:
        metrics["load_avg"] = os.getloadavg()
    except:
        pass

    # CPU Usage (approximate from /proc/stat if possible)
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
            if line.startswith("cpu"):
                fields = [float(x) for x in line.split()[1:]]
                idle = fields[3]
                total = sum(fields)
                # This needs two samples to be accurate, but for a daemon 
                # we can track the previous total/idle in memory.
                # For simplicity in this first write, we'll just log load avg 
                # or a very basic estimate if we don't want to block.
                # We'll use load_avg[0] as a proxy or do a 1s sleep once.
                pass
    except:
        pass

    # Memory Usage
    try:
        with open("/proc/meminfo", "r") as f:
            meminfo = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    meminfo[parts[0].strip()] = int(parts[1].split()[0])
            
            total = meminfo.get("MemTotal", 1)
            available = meminfo.get("MemAvailable", meminfo.get("MemFree", 0) + meminfo.get("Buffers", 0) + meminfo.get("Cached", 0))
            metrics["mem_percent"] = round(100.0 * (1.0 - (available / total)), 2)
    except:
        pass

    # Disk Usage (for root /)
    try:
        st = os.statvfs("/")
        free = st.f_bavail * st.f_frsize
        total = st.f_blocks * st.f_frsize
        metrics["disk_percent"] = round(100.0 * (1.0 - (free / total)), 2)
    except:
        pass

    return metrics

def probe_url(url):
    start = time.time()
    result = {
        "url": url,
        "status": "DOWN",
        "code": 0,
        "latency_ms": 0,
        "error": ""
    }
    try:
        # Note: /api/auth/validate will return 401 if not logged in, which is fine (Backend is UP)
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            result["code"] = response.getcode()
            result["status"] = "UP" if result["code"] in [200, 304] else "DOWN"
    except urllib.error.HTTPError as e:
        result["code"] = e.code
        # 401 is considered UP for the auth validation endpoint probe
        if "auth/validate" in url and e.code == 401:
            result["status"] = "UP"
        else:
            result["status"] = "DOWN"
        result["error"] = str(e)
    except Exception as e:
        result["error"] = str(e)
        result["status"] = "DOWN"
    
    result["latency_ms"] = int((time.time() - start) * 1000)
    return result

def send_telegram(text):
    if not BOT_TOKEN or not CHAT_ID:
        print(f"Skipping Telegram (not configured): {text}")
        return
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    data = json.dumps({
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }).encode("utf-8")
    
    try:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            pass
    except Exception as e:
        print(f"Failed to send Telegram: {e}")

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return {
        "last_alert_status": "UP",
        "consecutive_failures": 0,
        "consecutive_successes": 0,
        "last_summary_date": ""
    }

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def calculate_percentile(data, p):
    if not data: return 0
    data = sorted(data)
    idx = (len(data) - 1) * p / 100.0
    floor = int(idx)
    ceil = floor + 1
    if ceil < len(data):
        return data[floor] + (data[ceil] - data[floor]) * (idx - floor)
    return data[floor]

def run_daily_summary(state):
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    if state.get("last_summary_date") == yesterday:
        return
    
    print(f"Generating daily summary for {yesterday}")
    
    fe_latencies = []
    be_latencies = []
    mem_percents = []
    disk_percents = []
    
    total_samples = 0
    fe_up_count = 0
    be_up_count = 0
    both_up_count = 0
    
    if os.path.exists(SAMPLES_FILE):
        with open(SAMPLES_FILE, "r") as f:
            for line in f:
                try:
                    s = json.loads(line)
                    ts = s["resources"]["timestamp"][:10]
                    if ts != yesterday:
                        continue
                    
                    total_samples += 1
                    fe_up = s["frontend"]["status"] == "UP"
                    be_up = s["backend"]["status"] == "UP"
                    
                    if fe_up:
                        fe_up_count += 1
                        fe_latencies.append(s["frontend"]["latency_ms"])
                    if be_up:
                        be_up_count += 1
                        be_latencies.append(s["backend"]["latency_ms"])
                    if fe_up and be_up:
                        both_up_count += 1
                    
                    mem_percents.append(s["resources"]["mem_percent"])
                    disk_percents.append(s["resources"]["disk_percent"])
                except:
                    continue
    
    if total_samples == 0:
        print("No samples found for yesterday.")
        state["last_summary_date"] = yesterday
        return

    def fmt_stats(data):
        if not data: return "N/A"
        return f"Avg: {sum(data)/len(data):.1f}, Max: {max(data):.1f}, p99: {calculate_percentile(data, 99):.1f}"

    msg = f"📊 *Daily Monitoring Summary: {yesterday}*\n\n"
    msg += f"📈 *Uptime*\n"
    msg += f"• Frontend: {100.0*fe_up_count/total_samples:.2f}%\n"
    msg += f"• Backend: {100.0*be_up_count/total_samples:.2f}%\n"
    msg += f"• Combined: {100.0*both_up_count/total_samples:.2f}%\n\n"
    
    msg += f"⏱ *Latency (ms)*\n"
    msg += f"• Frontend: {fmt_stats(fe_latencies)}\n"
    msg += f"• Backend: {fmt_stats(be_latencies)}\n\n"
    
    msg += f"🖥 *Resources*\n"
    msg += f"• Mem: {fmt_stats(mem_percents)}%\n"
    msg += f"• Disk: {fmt_stats(disk_percents)}%\n"
    
    send_telegram(msg)
    state["last_summary_date"] = yesterday
    
    # Prune old samples
    prune_samples()

def prune_samples():
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d")
    temp_file = SAMPLES_FILE + ".tmp"
    try:
        with open(SAMPLES_FILE, "r") as f, open(temp_file, "w") as out:
            for line in f:
                try:
                    s = json.loads(line)
                    if s["resources"]["timestamp"][:10] >= cutoff:
                        out.write(line)
                except:
                    continue
        os.replace(temp_file, SAMPLES_FILE)
    except Exception as e:
        print(f"Pruning failed: {e}")

def main():
    print(f"Starting monitor for {HOST_URL} every {INTERVAL}s")
    state = load_state()
    
    while True:
        try:
            # 1. Probes
            fe_res = probe_url(FE_URL)
            be_res = probe_url(BE_URL)
            res_metrics = get_resource_metrics()
            
            sample = {
                "frontend": fe_res,
                "backend": be_res,
                "resources": res_metrics
            }
            
            # 2. Log
            with open(SAMPLES_FILE, "a") as f:
                f.write(json.dumps(sample) + "\n")
            
            # 3. Alert Logic (DOWN if BOTH are down, or as you prefer? 
            #   Let's say overall system is DOWN if either is down for 3 consecutive times)
            is_currently_up = (fe_res["status"] == "UP" and be_res["status"] == "UP")
            
            if not is_currently_up:
                state["consecutive_failures"] += 1
                state["consecutive_successes"] = 0
            else:
                state["consecutive_successes"] += 1
                state["consecutive_failures"] = 0
            
            # Falling edge: DOWN after 3 fails
            if state["consecutive_failures"] == 3 and state["last_alert_status"] == "UP":
                msg = f"🚨 *System DOWN Alert*\n\n"
                msg += f"Frontend: {fe_res['status']} ({fe_res['code']})\n"
                msg += f"Backend: {be_res['status']} ({be_res['code']})\n"
                if fe_res['error']: msg += f"\nFE Error: {fe_res['error']}"
                if be_res['error']: msg += f"\nBE Error: {be_res['error']}"
                send_telegram(msg)
                state["last_alert_status"] = "DOWN"
            
            # Recovery: UP after 3 successes
            if state["consecutive_successes"] == 3 and state["last_alert_status"] == "DOWN":
                send_telegram("✅ *System Recovery Notice*\n\nAll services are back online.")
                state["last_alert_status"] = "UP"
            
            # 4. Daily Summary Check (00:05 UTC)
            now_utc = datetime.now(timezone.utc)
            if now_utc.hour == 0 and now_utc.minute >= 5:
                run_daily_summary(state)
            
            save_state(state)
            
        except Exception as e:
            print(f"Loop error: {e}")
            
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()

