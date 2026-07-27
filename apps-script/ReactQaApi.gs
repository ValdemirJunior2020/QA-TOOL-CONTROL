/**
 * QA CONTROL CENTER - REACT WRITE API
 *
 * Add this as a NEW .gs file inside the SAME Apps Script project that already
 * contains your QA Tracker Code.gs and deployed Web App URL.
 *
 * It adds doPost(e) for the React app. It does not replace doGet(e), does not
 * rename tabs, does not clear Agents Reviewed, and does not move saved rows.
 */

const QA_APP_CONFIG = {
  SPREADSHEET_ID: "1GpR3siePgY45jGJfsAB2Q1obCW34A-tfKJOrI8ruEwg",
  REVIEW_SHEET_NAME: "Agents Reviewed",
  USERS_SHEET_NAME: "QA App Users",
  SETTINGS_SHEET_NAME: "QA App Settings",
  AUDIT_SHEET_NAME: "QA App Audit",
  EMAIL_DETAILS_SHEET_NAME: "Emails Sent Details",
  BACKUP_PREFIX: "QA Backup",
  PROXY_SECRET_PROPERTY: "QA_APP_PROXY_SECRET",
  CACHE_KEY: "agent-picks-agents-reviewed-v5",
  ADMIN_EMAILS: [
    "infojr.83@gmail.com",
    "barbara.kalchik8reserve@gmail.com"
  ]
};

const QA_APP_USER_HEADERS = [
  "Email",
  "Display Name",
  "Role",
  "Active",
  "Guided Mode",
  "Can Submit Reviews",
  "Can View History",
  "Can Edit Agent Details",
  "Can Edit Criteria Selections",
  "Can Edit Custom Notes",
  "Notes",
  "Created At",
  "Updated At",
  "Updated By"
];

const QA_APP_AUDIT_HEADERS = [
  "Timestamp",
  "Action",
  "Actor Email",
  "Target Email",
  "Details JSON"
];

const QA_APP_SETTINGS_HEADERS = [
  "Key",
  "JSON Value",
  "Updated At",
  "Updated By"
];

function qaAppSetup() {
  const ss = SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);
  qaAppEnsureUsersSheet_(ss);
  qaAppEnsureSettingsSheet_(ss);
  qaAppEnsureAuditSheet_(ss);
  qaAppEnsureReviewHeaders_(ss);
  qaAppSeedCoreUsers_(ss);
  qaAppSeedDefaultSettings_(ss);

  const properties = PropertiesService.getScriptProperties();
  let secret = String(properties.getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || "").trim();

  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    properties.setProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY, secret);
  }

  SpreadsheetApp.getUi().alert(
    "QA React API Setup Complete",
    "The React API sheets and core users are ready. No Agents Reviewed data was deleted or moved.\n\nCopy this secret into the Netlify environment variable QA_APP_PROXY_SECRET:\n\n" + secret,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function qaAppShowProxySecret() {
  const secret = String(
    PropertiesService.getScriptProperties().getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || ""
  ).trim();

  SpreadsheetApp.getUi().alert(
    secret
      ? "Current QA_APP_PROXY_SECRET:\n\n" + secret
      : "No proxy secret exists yet. Run qaAppSetup first."
  );
}

function doPost(e) {
  try {
    const request = qaAppParseRequest_(e);
    qaAppVerifyProxySecret_(request.proxySecret);

    const actorEmail = qaAppNormalizeEmail_(request.actorEmail);
    const actorName = qaAppCleanText_(request.actorName);
    const action = qaAppCleanText_(request.action).toLowerCase();

    if (!actorEmail) throw new Error("A verified Google account email is required.");

    const ss = SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);
    qaAppEnsureUsersSheet_(ss);
    qaAppEnsureSettingsSheet_(ss);
    qaAppEnsureAuditSheet_(ss);
    qaAppSeedCoreUsers_(ss);
    qaAppSeedDefaultSettings_(ss);

    const actor = qaAppGetUserByEmail_(ss, actorEmail);
    if (!actor) throw new Error("This Google account has not been added to the QA app.");
    if (!actor.active) throw new Error("This QA app account is blocked. Contact Junior or Barbara.");

    if (action === "authorize") {
      return qaAppJson_({ success: true, user: actor });
    }

    if (action === "bootstrap") {
      const settings = qaAppReadSettings_(ss);
      const users = actor.role === "admin" ? qaAppReadUsers_(ss) : [actor];
      return qaAppJson_({
        success: true,
        user: actor,
        users: users,
        settings: settings
      });
    }

    if (action === "savereview") {
      const result = qaAppSaveReview_(ss, actor, request.review || {}, actorName);
      return qaAppJson_(result);
    }

    if (action === "markemailsent") {
      const result = qaAppMarkEmailSent_(ss, actor, request);
      return qaAppJson_(result);
    }

    if (action === "exportreviews") {
      return qaAppJson_({ success: true, data: qaAppExportReviews_(ss) });
    }

    if (action === "createbackup") {
      qaAppAssertAdmin_(actor);
      return qaAppJson_({ success: true, message: qaAppCreateBackup_(ss, actorEmail) });
    }

    if (action === "restorelatestbackup") {
      qaAppAssertAdmin_(actor);
      return qaAppJson_({ success: true, message: qaAppRestoreLatestBackup_(ss, actorEmail) });
    }

    if (action === "upsertuser") {
      qaAppAssertAdmin_(actor);
      const savedUser = qaAppUpsertUser_(ss, request.user || {}, actorEmail);
      qaAppAudit_(ss, "USER UPSERTED", actorEmail, savedUser.email, savedUser);
      return qaAppJson_({
        success: true,
        message: savedUser.displayName + " was saved.",
        user: savedUser
      });
    }

    if (action === "setuserblocked") {
      qaAppAssertAdmin_(actor);
      const targetEmail = qaAppNormalizeEmail_(request.email);
      const blocked = qaAppBoolean_(request.blocked);
      const updated = qaAppSetUserBlocked_(ss, targetEmail, blocked, actorEmail);
      qaAppAudit_(ss, blocked ? "USER BLOCKED" : "USER UNBLOCKED", actorEmail, targetEmail, updated);
      return qaAppJson_({
        success: true,
        message: updated.displayName + (blocked ? " was blocked." : " was unblocked."),
        user: updated
      });
    }

    if (action === "savesettings") {
      qaAppAssertAdmin_(actor);
      const savedSettings = qaAppSaveSettings_(ss, request.settings || {}, actorEmail);
      qaAppAudit_(ss, "SETTINGS UPDATED", actorEmail, "", { keys: Object.keys(savedSettings) });
      return qaAppJson_({
        success: true,
        message: "QA settings were saved. Existing review rows were not changed.",
        settings: savedSettings
      });
    }

    throw new Error("Unsupported React API action: " + action);
  } catch (error) {
    return qaAppJson_({
      success: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}

function qaAppParseRequest_(e) {
  const raw = e && e.postData ? String(e.postData.contents || "") : "";
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("The React app sent invalid JSON.");
  }
}

function qaAppVerifyProxySecret_(providedSecret) {
  const expected = String(
    PropertiesService.getScriptProperties().getProperty(QA_APP_CONFIG.PROXY_SECRET_PROPERTY) || ""
  ).trim();

  if (!expected) {
    throw new Error("The Apps Script proxy secret is not configured. Run qaAppSetup once.");
  }

  if (String(providedSecret || "").trim() !== expected) {
    throw new Error("Unauthorized React API request.");
  }
}

function qaAppJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function qaAppSpreadsheet_() {
  return SpreadsheetApp.openById(QA_APP_CONFIG.SPREADSHEET_ID);
}

function qaAppEnsureUsersSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.USERS_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_USER_HEADERS.length).setValues([QA_APP_USER_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_USER_HEADERS.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppEnsureSettingsSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.SETTINGS_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_SETTINGS_HEADERS.length).setValues([QA_APP_SETTINGS_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_SETTINGS_HEADERS.length);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 650);
  return sheet;
}

function qaAppEnsureAuditSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.AUDIT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.AUDIT_SHEET_NAME);

  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, QA_APP_AUDIT_HEADERS.length).setValues([QA_APP_AUDIT_HEADERS]);
  }

  qaAppFormatHeader_(sheet, QA_APP_AUDIT_HEADERS.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppFormatHeader_(sheet, columns) {
  sheet.getRange(1, 1, 1, columns)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#24165f")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
}

function qaAppSeedCoreUsers_(ss) {
  const seeds = [
    qaAppBuildUser_("infojr.83@gmail.com", "Junior", "admin", true, false, "Primary administrator."),
    qaAppBuildUser_("barbara.kalchik8reserve@gmail.com", "Barbara", "admin", true, false, "Administrator."),
    qaAppBuildUser_(
      "shoultskelly22@gmail.com",
      "Kelly",
      "evaluator",
      true,
      true,
      "Guided Mode is enabled to provide friendly reminders and a final double-check before saving."
    )
  ];

  seeds.forEach(function(seed) {
    const existing = qaAppGetUserByEmail_(ss, seed.email);

    if (!existing) {
      qaAppWriteUser_(ss, seed, "qaAppSetup");
      return;
    }

    // Repair the required core-account access without creating duplicate rows.
    // This fixes Barbara when an older row exists but is blocked, has the wrong
    // role, or has missing permissions.
    const mustBeAdmin = QA_APP_CONFIG.ADMIN_EMAILS.indexOf(seed.email) >= 0;
    const repaired = Object.assign({}, existing, {
      displayName: seed.displayName,
      role: mustBeAdmin ? "admin" : existing.role,
      active: true,
      guidedMode: mustBeAdmin ? false : seed.guidedMode,
      permissions: mustBeAdmin
        ? {
            canSubmitReviews: true,
            canViewHistory: true,
            canEditAgentDetails: true,
            canEditCriteriaSelections: true,
            canEditCustomNotes: true
          }
        : existing.permissions,
      notes: existing.notes || seed.notes,
      createdAt: existing.createdAt || seed.createdAt
    });

    const needsRepair =
      repaired.displayName !== existing.displayName ||
      repaired.role !== existing.role ||
      repaired.active !== existing.active ||
      repaired.guidedMode !== existing.guidedMode ||
      JSON.stringify(repaired.permissions) !== JSON.stringify(existing.permissions);

    if (needsRepair) qaAppWriteUser_(ss, repaired, "qaAppSetup-repair");
  });
}

function qaAppBuildUser_(email, displayName, role, active, guidedMode, notes) {
  const isAdmin = role === "admin";
  return {
    email: qaAppNormalizeEmail_(email),
    displayName: qaAppCleanText_(displayName),
    role: role,
    active: active,
    guidedMode: isAdmin ? false : guidedMode,
    permissions: {
      canSubmitReviews: role !== "viewer",
      canViewHistory: true,
      canEditAgentDetails: role !== "viewer",
      canEditCriteriaSelections: role !== "viewer",
      canEditCustomNotes: role !== "viewer"
    },
    notes: qaAppCleanText_(notes),
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: "qaAppSetup"
  };
}

function qaAppReadUsers_(ss) {
  const sheet = qaAppEnsureUsersSheet_(ss);
  if (sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, QA_APP_USER_HEADERS.length).getValues();
  return values
    .map(function(row) { return qaAppUserFromRow_(row); })
    .filter(function(user) { return Boolean(user.email); });
}

function qaAppGetUserByEmail_(ss, email) {
  const target = qaAppNormalizeEmail_(email);
  if (!target) return null;

  const users = qaAppReadUsers_(ss);
  for (let i = 0; i < users.length; i++) {
    if (users[i].email === target) return users[i];
  }

  return null;
}

function qaAppUserFromRow_(row) {
  return {
    email: qaAppNormalizeEmail_(row[0]),
    displayName: qaAppCleanText_(row[1]),
    role: qaAppCleanText_(row[2]).toLowerCase() || "evaluator",
    active: qaAppBoolean_(row[3]),
    guidedMode: qaAppBoolean_(row[4]),
    permissions: {
      canSubmitReviews: qaAppBoolean_(row[5]),
      canViewHistory: qaAppBoolean_(row[6]),
      canEditAgentDetails: qaAppBoolean_(row[7]),
      canEditCriteriaSelections: qaAppBoolean_(row[8]),
      canEditCustomNotes: qaAppBoolean_(row[9])
    },
    notes: qaAppCleanText_(row[10]),
    createdAt: qaAppIso_(row[11]),
    updatedAt: qaAppIso_(row[12]),
    updatedBy: qaAppCleanText_(row[13])
  };
}

function qaAppWriteUser_(ss, user, actorEmail) {
  const sheet = qaAppEnsureUsersSheet_(ss);
  const now = new Date();
  const rowIndex = qaAppFindUserRow_(sheet, user.email);
  const existingCreatedAt = rowIndex > 0 ? sheet.getRange(rowIndex, 12).getValue() : "";
  const createdAt = existingCreatedAt || user.createdAt || now;

  const row = [
    user.email,
    user.displayName,
    user.role,
    Boolean(user.active),
    Boolean(user.guidedMode),
    Boolean(user.permissions.canSubmitReviews),
    Boolean(user.permissions.canViewHistory),
    Boolean(user.permissions.canEditAgentDetails),
    Boolean(user.permissions.canEditCriteriaSelections),
    Boolean(user.permissions.canEditCustomNotes),
    user.notes || "",
    createdAt,
    now,
    actorEmail
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return qaAppGetUserByEmail_(ss, user.email);
}

function qaAppFindUserRow_(sheet, email) {
  const target = qaAppNormalizeEmail_(email);
  if (!target || sheet.getLastRow() < 2) return 0;

  const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < emails.length; i++) {
    if (qaAppNormalizeEmail_(emails[i][0]) === target) return i + 2;
  }

  return 0;
}

function qaAppUpsertUser_(ss, rawUser, actorEmail) {
  const email = qaAppNormalizeEmail_(rawUser.email);
  const displayName = qaAppCleanText_(rawUser.displayName);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!displayName) throw new Error("Enter the person’s name.");

  const adminWhitelist = QA_APP_CONFIG.ADMIN_EMAILS.indexOf(email) >= 0;
  let role = qaAppCleanText_(rawUser.role).toLowerCase();
  if (["admin", "evaluator", "viewer"].indexOf(role) < 0) role = "evaluator";

  if (role === "admin" && !adminWhitelist) {
    throw new Error("Only Junior and Barbara can be administrators.");
  }

  if (adminWhitelist) role = "admin";

  const existing = qaAppGetUserByEmail_(ss, email);
  const requestedPermissions = rawUser.permissions || {};
  const isAdmin = role === "admin";
  const isViewer = role === "viewer";

  const user = {
    email: email,
    displayName: displayName,
    role: role,
    active: isAdmin ? true : rawUser.active !== false,
    guidedMode: isAdmin ? false : qaAppBoolean_(rawUser.guidedMode),
    permissions: {
      canSubmitReviews: isAdmin ? true : isViewer ? false : rawUser.permissions ? qaAppBoolean_(requestedPermissions.canSubmitReviews) : true,
      canViewHistory: isAdmin ? true : rawUser.permissions ? qaAppBoolean_(requestedPermissions.canViewHistory) : true,
      canEditAgentDetails: isAdmin ? true : isViewer ? false : rawUser.permissions ? qaAppBoolean_(requestedPermissions.canEditAgentDetails) : true,
      canEditCriteriaSelections: isAdmin ? true : isViewer ? false : rawUser.permissions ? qaAppBoolean_(requestedPermissions.canEditCriteriaSelections) : true,
      canEditCustomNotes: isAdmin ? true : isViewer ? false : rawUser.permissions ? qaAppBoolean_(requestedPermissions.canEditCustomNotes) : true
    },
    notes: qaAppCleanText_(rawUser.notes),
    createdAt: existing && existing.createdAt ? new Date(existing.createdAt) : new Date()
  };

  return qaAppWriteUser_(ss, user, actorEmail);
}

function qaAppSetUserBlocked_(ss, targetEmail, blocked, actorEmail) {
  if (!targetEmail) throw new Error("Select a user account.");
  if (QA_APP_CONFIG.ADMIN_EMAILS.indexOf(targetEmail) >= 0) {
    throw new Error("Junior and Barbara administrator accounts cannot be blocked from this screen.");
  }

  const user = qaAppGetUserByEmail_(ss, targetEmail);
  if (!user) throw new Error("That QA app user was not found.");
  user.active = !blocked;
  return qaAppWriteUser_(ss, user, actorEmail);
}

function qaAppAssertAdmin_(user) {
  if (!user || user.role !== "admin" || QA_APP_CONFIG.ADMIN_EMAILS.indexOf(user.email) < 0) {
    throw new Error("Only Junior or Barbara can perform this admin action.");
  }
}

function qaAppSeedDefaultSettings_(ss) {
  const sheet = qaAppEnsureSettingsSheet_(ss);
  const defaults = qaAppDefaultSettings_();
  const existing = qaAppSettingsMap_(sheet);

  ["criteria", "callCenters", "statusOptions", "rules"].forEach(function(key) {
    if (!existing[key]) qaAppWriteSetting_(sheet, key, defaults[key], "qaAppSetup");
  });
}

function qaAppReadSettings_(ss) {
  const defaults = qaAppDefaultSettings_();
  const sheet = qaAppEnsureSettingsSheet_(ss);
  const values = qaAppSettingsMap_(sheet);

  return {
    criteria: values.criteria || defaults.criteria,
    callCenters: values.callCenters || defaults.callCenters,
    statusOptions: values.statusOptions || defaults.statusOptions,
    rules: Object.assign({}, defaults.rules, values.rules || {})
  };
}

function qaAppSaveSettings_(ss, rawSettings, actorEmail) {
  const defaults = qaAppDefaultSettings_();
  const criteria = rawSettings.criteria || defaults.criteria;
  const callCenters = Array.isArray(rawSettings.callCenters)
    ? rawSettings.callCenters.map(qaAppCleanText_).filter(Boolean)
    : defaults.callCenters;
  const statusOptions = Array.isArray(rawSettings.statusOptions)
    ? rawSettings.statusOptions.map(qaAppCleanText_).filter(Boolean)
    : defaults.statusOptions;
  const rules = Object.assign({}, defaults.rules, rawSettings.rules || {});

  qaAppValidateCriteriaSettings_(criteria);
  if (!callCenters.length) throw new Error("Keep at least one call center.");
  if (!statusOptions.length) throw new Error("Keep at least one QA status option.");

  const sheet = qaAppEnsureSettingsSheet_(ss);
  qaAppWriteSetting_(sheet, "criteria", criteria, actorEmail);
  qaAppWriteSetting_(sheet, "callCenters", callCenters, actorEmail);
  qaAppWriteSetting_(sheet, "statusOptions", statusOptions, actorEmail);
  qaAppWriteSetting_(sheet, "rules", rules, actorEmail);

  return qaAppReadSettings_(ss);
}

function qaAppValidateCriteriaSettings_(criteria) {
  ["CS", "Groups"].forEach(function(type) {
    if (!criteria || !Array.isArray(criteria[type]) || !criteria[type].length) {
      throw new Error(type + " must contain at least one criterion.");
    }

    criteria[type].forEach(function(item, index) {
      if (!qaAppCleanText_(item.name)) throw new Error(type + " criterion " + (index + 1) + " needs a name.");
      const points = Number(item.points);
      if (!isFinite(points) || points < 0) throw new Error(type + " criterion " + (index + 1) + " has invalid points.");
    });
  });
}

function qaAppSettingsMap_(sheet) {
  const result = {};
  if (sheet.getLastRow() < 2) return result;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  values.forEach(function(row) {
    const key = qaAppCleanText_(row[0]);
    if (!key || !row[1]) return;
    try {
      result[key] = JSON.parse(row[1]);
    } catch (error) {
      // Ignore a malformed row and use defaults for that setting.
    }
  });
  return result;
}

function qaAppWriteSetting_(sheet, key, value, actorEmail) {
  const lastRow = sheet.getLastRow();
  let rowIndex = 0;

  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (let i = 0; i < keys.length; i++) {
      if (qaAppCleanText_(keys[i][0]) === key) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  const row = [key, JSON.stringify(value), new Date(), actorEmail];
  if (rowIndex) sheet.getRange(rowIndex, 1, 1, 4).setValues([row]);
  else sheet.appendRow(row);
}

function qaAppDefaultSettings_() {
  return {
    criteria: {
      CS: [
        { number: 1, name: "Agent is ready / available to receive call", points: 2, notes: "Correct greeting/intro; professional tone; sets purpose." },
        { number: 2, name: "Verification", points: 8, notes: "Confirms first name, last name, email, itinerary or confirmation number, hotel name, and booking dates before taking action." },
        { number: 3, name: "Acknowledges Need / Empathy / Reiteration", points: 10, notes: "Acknowledges request; restates need; uses empathetic language." },
        { number: 4, name: "Matrix Compliance (Process + Escalation + Tools)", points: 20, notes: "Follows correct matrix process, tools, escalation path, and timelines." },
        { number: 5, name: "Ownership & Solutioning", points: 10, notes: "Owns the issue, explains options, asks probing questions, and guides the guest." },
        { number: 6, name: "Efficiency & Expectations", points: 10, notes: "Sets clear expectations/timeframes, manages hold, and provides updates." },
        { number: 7, name: "Documentation Quality", points: 20, notes: "Notes are complete, accurate, and aligned with the action taken." },
        { number: 8, name: "Telephone Technique / Communication", points: 10, notes: "Clear pace, confidence, active listening, call control, professional language, no language barrier, and no dead air." },
        { number: 9, name: "Recap & Next Steps", points: 10, notes: "Summarizes outcome, confirms next step, and closes clearly." }
      ],
      Groups: [
        { number: 1, name: "Agent is ready to receive call", points: 4, notes: "Agent begins speaking within 3-5 seconds of being connected to the call." },
        { number: 2, name: "Correct Introduction", points: 6, notes: "Agent answers using the required Hotel Reservations introduction." },
        { number: 3, name: "Acknowledges Guest Request / Reiterates Needs", points: 5, notes: "Agent shows understanding of the guest's reason for calling and restates the request." },
        { number: 4, name: "Group Request Documentation Accuracy", points: 20, notes: "Agent captures all required information in the correct location, including Travel Agent information when applicable, and verifies email with phonetics." },
        { number: 5, name: "Honest Representation of HotelPlanner / Partner", points: 20, notes: "Agent answers honestly about the company and does not misrepresent the hotel or service." },
        { number: 6, name: "Ownership / Call Control / Guidance", points: 15, notes: "Agent asks leading questions, guides the guest, and completes the RFP." },
        { number: 7, name: "Telephone Techniques", points: 15, notes: "Agent is professional, actively listens, avoids speaking over the guest, avoids slang, uses a clear pace, and avoids dead air." },
        { number: 8, name: "Following Process and Closing Call", points: 15, notes: "Agent recaps details, gives the email and hotel response expectations, provides request credentials, offers more help, thanks the guest, and lets the guest disconnect first." }
      ]
    },
    callCenters: ["WNS", "TEP", "Concentrix", "Buwelo-G", "Buwelo-C", "Telus"],
    statusOptions: ["✓ Followed", "✕ Markdown", "N/A", "Partial"],
    rules: {
      confirmationRequired: true,
      callIdRequired: true,
      guidedCallIdPattern: "^CA[0-9A-Fa-f]{32}$",
      noteRequiredForMarkdownOrPartial: true,
      csKpi: 90,
      groupsKpi: 85
    }
  };
}

function qaAppSaveReview_(ss, actor, rawReview, actorName) {
  if (!actor.permissions.canSubmitReviews) throw new Error("Your account cannot submit QA reviews.");
  const requestId = qaAppCleanText_(rawReview.requestId);
  if (!requestId) throw new Error("The review request ID is missing. Refresh the app and try again.");
  const existingRow = qaAppFindReviewByRequestId_(ss, requestId);
  if (existingRow) return { success: true, message: "This review was already saved in row " + existingRow + ".", duplicate: true };
  if (!actor.permissions.canEditAgentDetails) {
    throw new Error("Your account cannot edit the agent and call details needed for a review.");
  }
  if (!actor.permissions.canEditCriteriaSelections) {
    throw new Error("Your account cannot select QA criterion statuses.");
  }

  const settings = qaAppReadSettings_(ss);
  const qaType = qaAppNormalizeQaType_(rawReview.qaType);
  if (!qaType) throw new Error("Select CS or Groups.");

  const definitions = settings.criteria[qaType];
  const statuses = settings.statusOptions;
  const answers = Array.isArray(rawReview.criteria) ? rawReview.criteria : [];
  const agentStartDate = qaAppDateFromInput_(rawReview.agentStartDate);
  const callDate = qaAppDateFromInput_(rawReview.callDate);
  const evaluator = actor.role === "admin"
    ? qaAppValidateEvaluator_(ss, rawReview.evaluator || actor.displayName)
    : actor.displayName;
  const agentName = qaAppCleanText_(rawReview.agentName);
  const callCenter = qaAppCleanText_(rawReview.callCenter);
  const callId = qaAppCleanText_(rawReview.callId).replace(/\s+/g, "");
  const confirmation = qaAppCleanText_(rawReview.confirmationNumber || rawReview.itineraryNumber);
  const callLength = qaAppCleanText_(rawReview.callLength);

  if (!agentStartDate) throw new Error("Add the agent start date.");
  if (!agentName) throw new Error("Add the agent name.");
  if (settings.callCenters.indexOf(callCenter) < 0) throw new Error("Select a valid call center.");
  if (settings.rules.callIdRequired && !callId) throw new Error("Add the Call ID.");
  if (settings.rules.confirmationRequired && confirmation.length < 2) {
    throw new Error("Add an itinerary, confirmation number, reservation number, or booking reference.");
  }
  if (!callLength) throw new Error("Add the call length.");
  if (!callDate) throw new Error("Add the date of the call.");

  if (actor.guidedMode) {
    let callIdPattern;
    try {
      callIdPattern = new RegExp(settings.rules.guidedCallIdPattern);
    } catch (error) {
      throw new Error("The Guided Mode Call ID pattern is invalid. Ask Junior or Barbara to repair it in Admin Control.");
    }

    if (!callIdPattern.test(callId)) {
      throw new Error("The Call ID must start with CA and contain exactly 32 hexadecimal characters after CA.");
    }
  }

  if (!actor.permissions.canEditCustomNotes) {
    const hasSubmittedNotes = answers.some(function(answer) {
      return Boolean(qaAppCleanText_(answer && answer.customNote));
    });
    if (hasSubmittedNotes) throw new Error("Your account cannot add custom notes.");
  }

  const calculatedCriteria = [];
  let finalScore = 0;
  let markdowns = 0;

  definitions.forEach(function(definition, index) {
    const answer = answers.find(function(item) {
      return Number(item.number) === Number(definition.number);
    }) || answers[index] || {};

    const status = qaAppCleanText_(answer.status);
    if (statuses.indexOf(status) < 0) {
      throw new Error("Select a status for criterion " + definition.number + ": " + definition.name + ".");
    }

    const customNote = qaAppCleanText_(answer.customNote);
    if (
      settings.rules.noteRequiredForMarkdownOrPartial &&
      (status === "✕ Markdown" || status === "Partial") &&
      !customNote
    ) {
      throw new Error("Add a clear note for criterion " + definition.number + " because " + status + " was selected.");
    }

    const points = Number(definition.points) || 0;
    const partialPoints = status === "Partial" ? points / 2 : "";
    let autoPoints = 0;
    if (status === "✓ Followed" || status === "N/A") autoPoints = points;
    if (status === "Partial") autoPoints = points / 2;
    if (status === "✕ Markdown") markdowns += 1;

    finalScore += autoPoints;
    calculatedCriteria.push({
      number: definition.number,
      name: definition.name,
      points: points,
      status: status,
      partialPoints: partialPoints,
      autoPoints: autoPoints,
      notes: definition.notes || "",
      customNote: customNote
    });
  });

  const kpiTarget = qaType === "Groups" ? Number(settings.rules.groupsKpi) : Number(settings.rules.csKpi);
  const result = finalScore >= kpiTarget ? "PASS" : "FAIL";
  const rowNumber = qaAppAppendReview_(ss, {
    requestId: requestId,
    savedTimestamp: new Date(),
    agentStartDate: agentStartDate,
    todayDate: new Date(),
    evaluator: evaluator,
    agentName: agentName,
    callCenter: callCenter,
    callId: callId,
    qaType: qaType,
    finalScore: finalScore,
    kpiTarget: kpiTarget,
    result: result,
    markdowns: markdowns,
    criteria: calculatedCriteria,
    confirmationNumber: confirmation,
    callLength: callLength,
    callDate: callDate
  });

  qaAppAudit_(ss, "REVIEW SAVED", actor.email, "", {
    rowNumber: rowNumber,
    evaluator: evaluator,
    agentName: agentName,
    callCenter: callCenter,
    qaType: qaType,
    finalScore: finalScore,
    actorName: actorName
  });

  try {
    CacheService.getScriptCache().remove(QA_APP_CONFIG.CACHE_KEY);
  } catch (error) {
    // Cache removal must never block saving.
  }

  return {
    success: true,
    message: "Review saved to Agents Reviewed row " + rowNumber + ".",
    review: {
      id: "agents-reviewed-" + rowNumber,
      rowNumber: rowNumber,
      savedTimestamp: new Date().toISOString(),
      agentStartDate: qaAppDateOnlyIso_(agentStartDate),
      reviewDate: qaAppDateOnlyIso_(new Date()),
      evaluator: evaluator,
      agentName: agentName,
      callCenter: callCenter,
      callId: callId,
      itineraryNumber: confirmation,
      emailSent: false,
      qaType: qaType,
      finalScore: finalScore,
      kpiTarget: kpiTarget,
      result: result,
      markdowns: markdowns,
      issueSummary: calculatedCriteria
        .filter(function(item) { return item.customNote; })
        .map(function(item) { return item.name + " - " + item.status + " - " + item.customNote; })
        .join(" | ")
    }
  };
}

function qaAppValidateEvaluator_(ss, evaluatorName) {
  const target = qaAppCleanText_(evaluatorName);
  const users = qaAppReadUsers_(ss);
  const found = users.find(function(user) {
    return user.active && user.role !== "viewer" && user.displayName === target;
  });
  if (!found) throw new Error("Select an active evaluator.");
  return found.displayName;
}

function qaAppEnsureReviewHeaders_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.REVIEW_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.REVIEW_SHEET_NAME);

  const required = qaAppReviewHeaders_();
  let current = [];
  if (sheet.getLastColumn() > 0) {
    current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map(function(value) { return qaAppCleanText_(value); });
  }

  if (!current.length || !current[0]) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    qaAppFormatHeader_(sheet, required.length);
    return sheet;
  }

  required.forEach(function(header) {
    if (current.indexOf(header) < 0) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(header);
      current.push(header);
    }
  });

  qaAppFormatHeader_(sheet, sheet.getLastColumn());
  return sheet;
}

function qaAppAppendReview_(ss, review) {
  const sheet = qaAppEnsureReviewHeaders_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return qaAppCleanText_(value); });
  const valuesByHeader = {};

  valuesByHeader["Request ID"] = review.requestId || "";
  valuesByHeader["Saved Timestamp"] = review.savedTimestamp;
  valuesByHeader["Agent Start Date"] = review.agentStartDate;
  valuesByHeader["Today's Date"] = review.todayDate;
  valuesByHeader["Evaluator"] = review.evaluator;
  valuesByHeader["Agent Name"] = review.agentName;
  valuesByHeader["Call Center"] = review.callCenter;
  valuesByHeader["Call ID"] = review.callId;
  valuesByHeader["Email Sent?"] = false;
  valuesByHeader["QA Type"] = review.qaType;
  valuesByHeader["Final Score"] = review.finalScore;
  valuesByHeader["KPI Target"] = review.kpiTarget;
  valuesByHeader["Result"] = review.result;
  valuesByHeader["Markdowns"] = review.markdowns;

  for (let index = 1; index <= 9; index++) {
    const criterion = review.criteria[index - 1] || {};
    valuesByHeader["Criteria " + index + " #"] = criterion.number || "";
    valuesByHeader["Criteria " + index + " Name"] = criterion.name || "";
    valuesByHeader["Criteria " + index + " Max Points"] = criterion.points === undefined ? "" : criterion.points;
    valuesByHeader["Criteria " + index + " Status"] = criterion.status || "";
    valuesByHeader["Criteria " + index + " Partial Points"] = criterion.partialPoints === undefined ? "" : criterion.partialPoints;
    valuesByHeader["Criteria " + index + " Auto Points"] = criterion.autoPoints === undefined ? "" : criterion.autoPoints;
    valuesByHeader["Criteria " + index + " Notes / Issue Found"] = criterion.notes || "";
    valuesByHeader["Custom Note " + index] = criterion.customNote || "";
  }

  valuesByHeader["Itinerary Number"] = review.confirmationNumber || "";
  valuesByHeader["Length of Call"] = review.callLength || "";
  valuesByHeader["Date of Call"] = review.callDate || "";

  const rowValues = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : "";
  });

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);

    const index = qaAppHeaderIndex_(headers);
    qaAppFormatSavedReviewRow_(sheet, rowNumber, index);
    SpreadsheetApp.flush();
    return rowNumber;
  } finally {
    lock.releaseLock();
  }
}

function qaAppFormatSavedReviewRow_(sheet, row, index) {
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setVerticalAlignment("middle").setWrap(true);

  ["Saved Timestamp"].forEach(function(header) {
    if (index[header] !== undefined) sheet.getRange(row, index[header] + 1).setNumberFormat("m/d/yyyy h:mm AM/PM");
  });

  ["Agent Start Date", "Today's Date", "Date of Call"].forEach(function(header) {
    if (index[header] !== undefined) sheet.getRange(row, index[header] + 1).setNumberFormat("m/d/yyyy");
  });

  if (index["Length of Call"] !== undefined) {
    sheet.getRange(row, index["Length of Call"] + 1).setNumberFormat("@");
  }

  if (index["Email Sent?"] !== undefined) {
    const cell = sheet.getRange(row, index["Email Sent?"] + 1);
    cell.insertCheckboxes().setValue(false).setHorizontalAlignment("center");
  }

  if (index["Result"] !== undefined) {
    const resultCell = sheet.getRange(row, index["Result"] + 1);
    if (String(resultCell.getValue()).toUpperCase() === "PASS") {
      resultCell.setBackground("#d9ead3").setFontColor("#274e13").setFontWeight("bold");
    } else {
      resultCell.setBackground("#f4cccc").setFontColor("#990000").setFontWeight("bold");
    }
  }
}

function qaAppReviewHeaders_() {
  const headers = [
    "Request ID",
    "Saved Timestamp",
    "Agent Start Date",
    "Today's Date",
    "Evaluator",
    "Agent Name",
    "Call Center",
    "Call ID",
    "Email Sent?",
    "QA Type",
    "Final Score",
    "KPI Target",
    "Result",
    "Markdowns"
  ];

  for (let index = 1; index <= 9; index++) {
    headers.push("Criteria " + index + " #");
    headers.push("Criteria " + index + " Name");
    headers.push("Criteria " + index + " Max Points");
    headers.push("Criteria " + index + " Status");
    headers.push("Criteria " + index + " Partial Points");
    headers.push("Criteria " + index + " Auto Points");
    headers.push("Criteria " + index + " Notes / Issue Found");
  }

  for (let index = 1; index <= 9; index++) headers.push("Custom Note " + index);
  headers.push("Itinerary Number");
  headers.push("Length of Call");
  headers.push("Date of Call");
  return headers;
}

function qaAppHeaderIndex_(headers) {
  const result = {};
  headers.forEach(function(header, index) { result[header] = index; });
  return result;
}

function qaAppAudit_(ss, action, actorEmail, targetEmail, details) {
  try {
    const sheet = qaAppEnsureAuditSheet_(ss);
    sheet.appendRow([
      new Date(),
      action,
      actorEmail || "",
      targetEmail || "",
      JSON.stringify(details || {})
    ]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat("m/d/yyyy h:mm AM/PM");
  } catch (error) {
    // Audit failures must not erase a completed review or admin action.
  }
}

function qaAppNormalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function qaAppCleanText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function qaAppBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;
  return ["true", "yes", "1", "active"].indexOf(String(value || "").trim().toLowerCase()) >= 0;
}

function qaAppIso_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}

function qaAppDateOnlyIso_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function qaAppDateFromInput_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  const text = String(value || "").trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0, 0);
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]), 12, 0, 0, 0);
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function qaAppNormalizeQaType_(value) {
  const normalized = qaAppCleanText_(value).toLowerCase();
  if (normalized === "cs" || normalized === "customer service") return "CS";
  if (normalized === "groups" || normalized === "group") return "Groups";
  return "";
}


function qaAppFindReviewByRequestId_(ss, requestId) {
  const sheet = qaAppEnsureReviewHeaders_(ss);
  if (sheet.getLastRow() < 2) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(qaAppCleanText_);
  const index = headers.indexOf("Request ID");
  if (index < 0) return 0;
  const values = sheet.getRange(2, index + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) if (qaAppCleanText_(values[i][0]) === requestId) return i + 2;
  return 0;
}

function qaAppEnsureEmailDetailsSheet_(ss) {
  let sheet = ss.getSheetByName(QA_APP_CONFIG.EMAIL_DETAILS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QA_APP_CONFIG.EMAIL_DETAILS_SHEET_NAME);
  const headers = ["Timestamp", "Review Row", "Review ID", "Agent Name", "Call Center", "Evaluator", "Call ID", "Itinerary Number", "Email Sent", "Updated By Email", "Updated By Name"];
  if (sheet.getLastRow() === 0 || !sheet.getRange(1,1).getValue()) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  qaAppFormatHeader_(sheet, headers.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function qaAppMarkEmailSent_(ss, actor, request) {
  if (actor.role === "viewer") throw new Error("Viewer accounts cannot change email status.");
  const rowNumber = Number(request.rowNumber);
  if (!rowNumber || rowNumber < 2) throw new Error("A valid Agents Reviewed row is required.");
  const sheet = qaAppEnsureReviewHeaders_(ss);
  if (rowNumber > sheet.getLastRow()) throw new Error("That review row was not found.");
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(qaAppCleanText_);
  const index = qaAppHeaderIndex_(headers);
  if (index["Email Sent?"] === undefined) throw new Error("Email Sent? column was not found.");
  const sent = qaAppBoolean_(request.sent);
  sheet.getRange(rowNumber, index["Email Sent?"] + 1).insertCheckboxes().setValue(sent);
  const row = sheet.getRange(rowNumber,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  const get = function(name) { return index[name] === undefined ? "" : row[index[name]]; };
  const details = qaAppEnsureEmailDetailsSheet_(ss);
  details.appendRow([new Date(), rowNumber, request.reviewId || "", get("Agent Name"), get("Call Center"), get("Evaluator"), get("Call ID"), get("Itinerary Number"), sent, actor.email, actor.displayName]);
  details.getRange(details.getLastRow(),1).setNumberFormat("m/d/yyyy h:mm AM/PM");
  qaAppAudit_(ss, sent ? "EMAIL MARKED SENT" : "EMAIL MARKED NOT SENT", actor.email, "", { rowNumber: rowNumber });
  try { CacheService.getScriptCache().remove(QA_APP_CONFIG.CACHE_KEY); } catch (error) {}
  return { success: true, message: "Email status saved and logged in Emails Sent Details." };
}

function qaAppExportReviews_(ss) {
  const source = qaAppEnsureReviewHeaders_(ss);
  const temp = SpreadsheetApp.create("QA Reviews Export " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HHmmss"));
  const target = temp.getSheets()[0];
  target.setName(QA_APP_CONFIG.REVIEW_SHEET_NAME);
  const range = source.getDataRange();
  const values = range.getValues();
  target.getRange(1, 1, values.length, values[0].length).setValues(values);
  target.setFrozenRows(1);
  SpreadsheetApp.flush();
  const url = "https://www.googleapis.com/drive/v3/files/" + temp.getId() + "/export?mimeType=" + encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  DriveApp.getFileById(temp.getId()).setTrashed(true);
  return { filename: "Agents-Reviewed-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".xlsx", base64: Utilities.base64Encode(response.getBlob().getBytes()) };
}

function qaAppBackupSheetNames_() {
  return [QA_APP_CONFIG.REVIEW_SHEET_NAME, QA_APP_CONFIG.USERS_SHEET_NAME, QA_APP_CONFIG.SETTINGS_SHEET_NAME, QA_APP_CONFIG.AUDIT_SHEET_NAME, QA_APP_CONFIG.EMAIL_DETAILS_SHEET_NAME];
}

function qaAppCreateBackup_(ss, actorEmail) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  qaAppBackupSheetNames_().forEach(function(name) {
    const source = ss.getSheetByName(name);
    if (!source) return;
    const copy = source.copyTo(ss).setName(QA_APP_CONFIG.BACKUP_PREFIX + " " + stamp + " - " + name);
    copy.hideSheet();
  });
  PropertiesService.getScriptProperties().setProperty("QA_LATEST_BACKUP_STAMP", stamp);
  qaAppAudit_(ss, "BACKUP CREATED", actorEmail, "", { stamp: stamp });
  return "Backup " + stamp + " was created successfully.";
}

function qaAppRestoreLatestBackup_(ss, actorEmail) {
  const stamp = String(PropertiesService.getScriptProperties().getProperty("QA_LATEST_BACKUP_STAMP") || "").trim();
  if (!stamp) throw new Error("No QA backup is available yet.");
  qaAppBackupSheetNames_().forEach(function(name) {
    const backup = ss.getSheetByName(QA_APP_CONFIG.BACKUP_PREFIX + " " + stamp + " - " + name);
    if (!backup) return;
    let target = ss.getSheetByName(name);
    if (!target) target = ss.insertSheet(name);
    target.clear();
    backup.getDataRange().copyTo(target.getRange(1,1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  });
  qaAppAudit_(ss, "BACKUP RESTORED", actorEmail, "", { stamp: stamp });
  return "Backup " + stamp + " was restored.";
}
