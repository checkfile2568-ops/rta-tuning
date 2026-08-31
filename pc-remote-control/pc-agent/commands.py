import ctypes
import datetime as dt
import os
import subprocess

ALLOWED = {"LOCK","SLEEP","HIBERNATE","RESTART","SHUTDOWN","CANCEL_SHUTDOWN"}
MAX_TIMER_SECONDS = 7 * 24 * 60 * 60

class CommandError(Exception):
    pass

def _seconds(parameters):
    try: value = int((parameters or {}).get("seconds", 0))
    except (TypeError, ValueError): raise CommandError("seconds must be an integer")
    if value < 0 or value > MAX_TIMER_SECONDS: raise CommandError("seconds is outside allowed range")
    return value

def execute(command, parameters=None):
    if os.name != "nt": raise CommandError("Windows commands are disabled on non-Windows hosts")
    if command not in ALLOWED: raise CommandError("command not in allowlist")
    parameters = parameters or {}
    if command == "LOCK":
        if not ctypes.windll.user32.LockWorkStation(): raise CommandError("LockWorkStation failed")
        return {"message":"Windows locked"}
    if command == "SLEEP":
        subprocess.run(["rundll32.exe","powrprof.dll,SetSuspendState","0,1,0"], check=True); return {"message":"Sleep requested"}
    if command == "HIBERNATE":
        subprocess.run(["shutdown","/h"], check=True); return {"message":"Hibernate requested"}
    if command in {"SHUTDOWN","RESTART"}:
        seconds=_seconds(parameters); mode="/s" if command=="SHUTDOWN" else "/r"; subprocess.run(["shutdown",mode,"/t",str(seconds)],check=True); due=dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=seconds); return {"message":f"{command} scheduled","shutdown_due_at":due.isoformat(),"shutdown_action":command}
    if command == "CANCEL_SHUTDOWN":
        proc=subprocess.run(["shutdown","/a"],capture_output=True,text=True)
        if proc.returncode != 0: raise CommandError((proc.stderr or proc.stdout or "no shutdown was scheduled").strip())
        return {"message":"Scheduled shutdown cancelled","shutdown_due_at":None,"shutdown_action":None}
    raise CommandError("Unhandled command")
