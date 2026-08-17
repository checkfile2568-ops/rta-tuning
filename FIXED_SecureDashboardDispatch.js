/*
 * FIXED_SecureDashboardDispatch.js
 *
 * Secure dispatcher สำหรับ Dashboard
 *
 * หลักการ:
 * - Dashboard เรียก secureDashboardCall_FIXED(method, args, request)
 * - server ตรวจ adminKey/email ทุกครั้งก่อน dispatch
 * - อนุญาตเฉพาะรายชื่อ method ที่อยู่ใน allowlist
 * - ไม่ใช้ eval และไม่รับชื่อฟังก์ชัน arbitrary
 * - logic ธุรกิจเดิมยังถูกเรียกต่อด้วย arguments เดิม
 */

var FIXED_DASHBOARD_ALLOWED_METHODS_ = {
  getDashboardData: true,
  getGeneralInfoCards: true,
  getGeneralInfoSavedValues: true,
  getKnowledgeData: true,
  getLineQuotaInfo: true,
  getMasterSwitches: true,
  getMemberSyncStatus: true,
  getMembersData: true,
  getOnlineCourtSettings: true,
  getOnlineCourtUsageStats: true,
  getPermissionAuditLogs: true,
  getPhotoStats: true,
  getSavedIds: true,
  getScheduledNotify: true,
  getSearchDatabases: true,
  getSearchDbRecords: true,
  getSearchStats: true,
  getSettingsPayloadLight: true,
  getSystemSettings: true,
  quickDiagnostic: true,
  runHealthCheck: true,
  runMasterHealthCheck: true,
  testCourtLookup: true,
  testHealthCheck: true,
  getPhotoFolderStatus: true,
  checkPersonalArchiveFolder: true,
  checkPhotoFolder: true,
  getSearchDbRecords: true,
  saveCourtConfig: true,
  saveGeneralInfoCards: true,
  saveGeneralInfoValues: true,
  saveHealthSettings: true,
  saveMultipleConfigs: true,
  saveOnlineCourtConfigs: true,
  saveOnlineCourtDraftTextConfigs: true,
  saveOnlineCourtRoomIds: true,
  saveSummarySettings: true,
  setMemberSyncSchedule: true,
  toggleMasterSwitch: true,
  emergencyEnableCore: true,
  emergencyShutdownAll: true,
  addPreNotifyReminders: true,
  addSavedId: true,
  addScheduledNotify: true,
  addSearchDatabase: true,
  addSearchRecord: true,
  autoCreatePhotoFolder: true,
  autoFixIssue: true,
  createPersonalArchiveFolder: true,
  deleteSavedId: true,
  deleteScheduledNotify: true,
  deleteSearchDatabase: true,
  deleteSearchRecord: true,
  repairAndUpgradeSheets: true,
  repairFullSystemLight: true,
  repairOnlineCourtUsageSheets: true,
  setupOnlineCourtTestRoom: true,
  syncMemberNamesFromLine: true,
  unlinkPersonalArchiveFolder: true,
  unlinkPhotoFolder: true,
  updateMemberRole: true,
  updateSearchDatabase: true,
  uploadKnowledgeImage: true,
  sendLineNotification: true,
  testCourtFlexSend: true,
  testLineNotify: true,
  testSummary: true,
  debugOnlineCourtDecision: true,
  debugOnlineCourtUsageLog: true,
  checkUserPermission: true
};

function fixedSecureDashboardArgArray_(args) {
  return Array.isArray(args) ? args : [];
}

function fixedSecureDashboardAssertMethod_(method) {
  var name = String(method || "");
  if (!FIXED_DASHBOARD_ALLOWED_METHODS_[name]) {
    throw new Error("Dashboard method ไม่อยู่ใน allowlist: " + name);
  }
  return name;
}

function secureDashboardCall_FIXED(method, args, request) {
  var name = fixedSecureDashboardAssertMethod_(method);
  if (typeof requireDashboardAuthorization_FIXED !== "function") {
    throw new Error("ไม่พบ FIXED_AdminAuth.js");
  }
  requireDashboardAuthorization_FIXED(request, "dashboard:" + name);
  var argv = fixedSecureDashboardArgArray_(args);

  switch (name) {
    case "getDashboardData": return getDashboardData.apply(null, argv);
    case "getGeneralInfoCards": return getGeneralInfoCards.apply(null, argv);
    case "getGeneralInfoSavedValues": return getGeneralInfoSavedValues.apply(null, argv);
    case "getKnowledgeData": return getKnowledgeData.apply(null, argv);
    case "getLineQuotaInfo": return getLineQuotaInfo.apply(null, argv);
    case "getMasterSwitches": return getMasterSwitches.apply(null, argv);
    case "getMemberSyncStatus": return getMemberSyncStatus.apply(null, argv);
    case "getMembersData": return getMembersData.apply(null, argv);
    case "getOnlineCourtSettings": return getOnlineCourtSettings.apply(null, argv);
    case "getOnlineCourtUsageStats": return getOnlineCourtUsageStats.apply(null, argv);
    case "getPermissionAuditLogs": return getPermissionAuditLogs.apply(null, argv);
    case "getPhotoStats": return getPhotoStats.apply(null, argv);
    case "getSavedIds": return getSavedIds.apply(null, argv);
    case "getScheduledNotify": return getScheduledNotify.apply(null, argv);
    case "getSearchDatabases": return getSearchDatabases.apply(null, argv);
    case "getSearchDbRecords": return getSearchDbRecords.apply(null, argv);
    case "getSearchStats": return getSearchStats.apply(null, argv);
    case "getSettingsPayloadLight": return getSettingsPayloadLight.apply(null, argv);
    case "getSystemSettings": return getSystemSettings.apply(null, argv);
    case "quickDiagnostic": return quickDiagnostic.apply(null, argv);
    case "runHealthCheck": return runHealthCheck.apply(null, argv);
    case "runMasterHealthCheck": return runMasterHealthCheck.apply(null, argv);
    case "testCourtLookup": return testCourtLookup.apply(null, argv);
    case "testHealthCheck": return testHealthCheck.apply(null, argv);
    case "getPhotoFolderStatus": return getPhotoFolderStatus.apply(null, argv);
    case "checkPersonalArchiveFolder": return checkPersonalArchiveFolder.apply(null, argv);
    case "checkPhotoFolder": return checkPhotoFolder.apply(null, argv);
    case "saveCourtConfig": return saveCourtConfig.apply(null, argv);
    case "saveGeneralInfoCards": return saveGeneralInfoCards.apply(null, argv);
    case "saveGeneralInfoValues": return saveGeneralInfoValues.apply(null, argv);
    case "saveHealthSettings": return saveHealthSettings.apply(null, argv);
    case "saveMultipleConfigs": return saveMultipleConfigs.apply(null, argv);
    case "saveOnlineCourtConfigs": return saveOnlineCourtConfigs.apply(null, argv);
    case "saveOnlineCourtDraftTextConfigs": return saveOnlineCourtDraftTextConfigs.apply(null, argv);
    case "saveOnlineCourtRoomIds": return saveOnlineCourtRoomIds.apply(null, argv);
    case "saveSummarySettings": return saveSummarySettings.apply(null, argv);
    case "setMemberSyncSchedule": return setMemberSyncSchedule.apply(null, argv);
    case "toggleMasterSwitch": return toggleMasterSwitch.apply(null, argv);
    case "emergencyEnableCore": return emergencyEnableCore.apply(null, argv);
    case "emergencyShutdownAll": return emergencyShutdownAll.apply(null, argv);
    case "addPreNotifyReminders": return addPreNotifyReminders.apply(null, argv);
    case "addSavedId": return addSavedId.apply(null, argv);
    case "addScheduledNotify": return addScheduledNotify.apply(null, argv);
    case "addSearchDatabase": return addSearchDatabase.apply(null, argv);
    case "addSearchRecord": return addSearchRecord.apply(null, argv);
    case "autoCreatePhotoFolder": return autoCreatePhotoFolder.apply(null, argv);
    case "autoFixIssue": return autoFixIssue.apply(null, argv);
    case "createPersonalArchiveFolder": return createPersonalArchiveFolder.apply(null, argv);
    case "deleteSavedId": return deleteSavedId.apply(null, argv);
    case "deleteScheduledNotify": return deleteScheduledNotify.apply(null, argv);
    case "deleteSearchDatabase": return deleteSearchDatabase.apply(null, argv);
    case "deleteSearchRecord": return deleteSearchRecord.apply(null, argv);
    case "repairAndUpgradeSheets": return repairAndUpgradeSheets.apply(null, argv);
    case "repairFullSystemLight": return repairFullSystemLight.apply(null, argv);
    case "repairOnlineCourtUsageSheets": return repairOnlineCourtUsageSheets.apply(null, argv);
    case "setupOnlineCourtTestRoom": return setupOnlineCourtTestRoom.apply(null, argv);
    case "syncMemberNamesFromLine": return syncMemberNamesFromLine.apply(null, argv);
    case "unlinkPersonalArchiveFolder": return unlinkPersonalArchiveFolder.apply(null, argv);
    case "unlinkPhotoFolder": return unlinkPhotoFolder.apply(null, argv);
    case "updateMemberRole": return updateMemberRole.apply(null, argv);
    case "updateSearchDatabase": return updateSearchDatabase.apply(null, argv);
    case "uploadKnowledgeImage": return uploadKnowledgeImage.apply(null, argv);
    case "sendLineNotification": return sendLineNotification.apply(null, argv);
    case "testCourtFlexSend": return testCourtFlexSend.apply(null, argv);
    case "testLineNotify": return testLineNotify.apply(null, argv);
    case "testSummary": return testSummary.apply(null, argv);
    case "debugOnlineCourtDecision": return debugOnlineCourtDecision.apply(null, argv);
    case "debugOnlineCourtUsageLog": return debugOnlineCourtUsageLog.apply(null, argv);
    case "checkUserPermission": return checkUserPermission.apply(null, argv);
    default: throw new Error("Dashboard method dispatch ไม่สำเร็จ: " + name);
  }
}
