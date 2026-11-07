from pathlib import Path
import sys
def integrate(s):
 changes=[
 ("const API_VERSION = '1.2.0';","const API_VERSION = '1.3.0';"),
 ('function doPost(e) {','function doPost(e) {\n  const realResponse = realTrialDispatch_(e);\n  if (realResponse !== null) return realResponse;'),
 ("  if (TRAINING_SCOPE_) return trainingName_(code);", "  if (TRAINING_SCOPE_) return trainingName_(code);\n  if (code === 'EDITOR_OWNER') return 'เจ้าของโครงการ (ติดตั้งชุดทดสอบ)';"),
 ("  if (TRAINING_SCOPE_) return;", "  if (TRAINING_SCOPE_ || realTrialState_().active) return;"),
 ('const ctx = { uuid: body.client_uuid, action: action, user: null };','const ctx = { uuid: body.client_uuid, action: action, user: null, real_epoch: body.real_epoch };'),
 ('    const data = body.data &&',"    if (r.write && !TRAINING_SCOPE_) {\n      realTrialGuard_(ctx);\n      ctx.uuid = sha_('REAL|' + ctx.real_epoch + '|' + String(body.client_uuid || ''));\n      if (!/^[0-9a-zA-Z-]{16,64}$/.test(String(body.client_uuid || ''))) throw appErr_('BAD_UUID', 'ไม่มีรหัสรายการ');\n    }\n    const data = body.data &&"),
 ('ms: Date.now() - t0 });','ms: Date.now() - t0, realEpoch: realTrialEpoch_() });'),
 ("    user: publicUser_(me),", "    realTrial: realTrialPublic_(),\n    user: publicUser_(me),"),
 ("  const id = prop_('DB_ID');", "  const id = realTrialDbId_() || prop_('DB_ID');"),
 ("  const real=PropertiesService.getScriptProperties().getProperty('DB_ID');", "  const real=realTrialDbId_() || PropertiesService.getScriptProperties().getProperty('DB_ID');"),
 ("function prop_(k) { return PropertiesService", "function prop_(k) { if (k === 'DB_ID' && !TRAINING_SCOPE_) { const id = realTrialDbId_(); if (id) return id; } return PropertiesService"),
 ("  const hot = cache.get('OP_' + uuid);", "  realTrialGuard_(ctx);\n  const hot = cache.get('OP_' + uuid);"),
 ("    trainingAssertCurrent_();\n    resetDb_();\n    detectCrashed_();\n    const prev", "    trainingAssertCurrent_();\n    realTrialGuard_(ctx);\n    resetDb_();\n    detectCrashed_();\n    const prev"),
 ("function repairOperation_(actorCode, uuid, mode) {", "function repairOperation_(actorCode, uuid, mode, realEpoch) {"),
 ("return repairOperation_(ctx.user.code, str_(d.uuid, 64), mode);", "realTrialGuard_(ctx);\n  return repairOperation_(ctx.user.code, str_(d.uuid, 64), mode, ctx.real_epoch);"),
 ("    trainingAssertCurrent_();\n    resetDb_();\n    detectCrashed_();\n    const m = repairsMap_();", "    trainingAssertCurrent_();\n    realTrialGuard_({real_epoch: realEpoch});\n    resetDb_();\n    detectCrashed_();\n    const m = repairsMap_();"),
 ("runOp_({ uuid: Utilities.getUuid(), user: admin }", "runOp_({ uuid: Utilities.getUuid(), user: admin, real_epoch: realTrialEpoch_() }"),
 ("runOp_({ uuid: Utilities.getUuid(), user: officer }", "runOp_({ uuid: Utilities.getUuid(), user: officer, real_epoch: realTrialEpoch_() }"),
 ("    props.setProperty('DB_ID', copy.getId());", "    props.setProperty('DB_ID', copy.getId());\n    realTrialAdoptRestoredDb_(copy.getId());"),
 ("function trainingCacheKey_(key) { return TRAINING_SCOPE_ ? 'TR_'+TRAINING_SCOPE_.generation+'_'+key : key; }", "function trainingCacheKey_(key) { return TRAINING_SCOPE_ ? 'TR_'+TRAINING_SCOPE_.generation+'_'+key : 'REAL_'+realTrialEpoch_()+'_'+key; }")
 ]
 for old,new in changes:
  expected=2 if old in ['ms: Date.now() - t0 });'] else 1
  if s.count(old)!=expected:raise ValueError(f'Unexpected hook count {s.count(old)}: {old[:90]}')
  s=s.replace(old,new,expected)
 return s
if __name__=='__main__':Path(sys.argv[2]).write_text(integrate(Path(sys.argv[1]).read_text()))
