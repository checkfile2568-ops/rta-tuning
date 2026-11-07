"""Guarded integration into an exported CURRENT Apps Script source. Never fetches credentials.
Usage: python integrate.py current-Code.gs output-Code.gs
Add Training.gs as a separate project file as well. Inspect diff before deployment.
"""
import sys
from pathlib import Path

def integrate(source):
    if 'const trainingResponse = trainingDispatch_(e);' in source:
        raise ValueError('Training hooks already present; inspect current source instead of patching twice')
    hooks = [
      ('function doPost(e) {', 'function doPost(e) {\n  const trainingResponse = trainingDispatch_(e);\n  if (trainingResponse !== null) return trainingResponse;'),
      ('function db_() {', 'function db_() {\n  if (TRAINING_SCOPE_) {\n    if (!DB_.ss) DB_.ss = SpreadsheetApp.openById(TRAINING_SCOPE_.id);\n    return DB_.ss;\n  }'),
      ("getProperty(k); }", "getProperty(trainingPropertyKey_(k)); }"),
      ("setProperty(k, String(v)); }", "setProperty(trainingPropertyKey_(k), String(v)); }"),
      ("deleteProperty(k); }", "deleteProperty(trainingPropertyKey_(k)); }"),
      ('function putBig_(key, s, ttl) {','function putBig_(key, s, ttl) {\n  key = trainingCacheKey_(key);'),
      ('function getBig_(key) {','function getBig_(key) {\n  key = trainingCacheKey_(key);'),
      ('    resetDb_();\n    detectCrashed_();','    trainingAssertCurrent_();\n    resetDb_();\n    detectCrashed_();'),
      ('function notifyNewRequest_(req, pending) {', 'function notifyNewRequest_(req, pending) {\n  if (TRAINING_SCOPE_) return;')
    ]
    # Source variants MUST be reviewed, never guessed or overwritten.
    for old,new in hooks:
        expected = 2 if old == '    resetDb_();\n    detectCrashed_();' else 1
        if source.count(old)!=expected:
            raise ValueError('Expected exactly one hook: '+old[:90]+'; got '+str(source.count(old)))
        source=source.replace(old,new,expected)
    return source

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('Usage: python integrate.py current-Code.gs output-Code.gs')
    Path(sys.argv[2]).write_text(integrate(Path(sys.argv[1]).read_text()))
