import os
import platform
import socket
import time
import psutil

BOOT_TIME = psutil.boot_time()

def internet_ok(host="1.1.1.1", port=53, timeout=2):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def collect_metrics():
    root = os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else "/"
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(root)
    battery = psutil.sensors_battery()
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.15),
        "ram_percent": vm.percent,
        "ram_used_bytes": vm.used,
        "ram_total_bytes": vm.total,
        "disk_percent": disk.percent,
        "disk_free_bytes": disk.free,
        "disk_total_bytes": disk.total,
        "uptime_seconds": int(time.time() - BOOT_TIME),
        "battery_percent": battery.percent if battery else None,
        "battery_plugged": battery.power_plugged if battery else None,
        "internet_ok": internet_ok(),
        "windows_version": platform.platform(),
    }
