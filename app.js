const STORAGE_KEY = "cfp-erexit-manager-v1";
const SESSION_RESUME_KEY = "cfp-erexit-session-active";
const CLEANUP_MODE_KEY = "cfp-erexit-cleanup-until";
const SERVER_MODE = ["http:", "https:"].includes(window.location.protocol);
const PUBLIC_REGISTRATION_MODE = SERVER_MODE && window.location.pathname.replace(/\/+$/, "") === "/inscription";
let currentUser = null;
let studentPortalData = null;
let onlineRegistrationOptions = { courses: [], groups: [] };
let selectedGradeStudentId = 0;
let saveTimer = null;
let syncTimer = null;
let idleLogoutTimer = null;
let saveChain = Promise.resolve();
let lastSavedAt = "";
let serverRevision = "";
let hasPendingChanges = false;
let localChangeVersion = 0;
let lastSyncedState = null;
let lastIdleActivityAt = Date.now();
const IDLE_ACTIVITY_EVENTS = ["click", "keydown", "pointerdown", "touchstart", "scroll", "input"];
const personFileDrafts = {
  student: { photoData: "", documents: [] },
  trainer: { photoData: "", documents: [] },
  staff: { photoData: "", documents: [] }
};

const today = () => new Date().toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

function debounce(fn, delay = 180) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

const VIEW_LABELS = {
  dashboard: "Tableau de bord",
  onlineRequests: "Demandes en ligne",
  students: "Étudiants",
  courses: "Formations",
  groups: "Promotions",
  enrollments: "Inscriptions",
  payments: "Paiements",
  cash: "Caisse",
  notifications: "Notifications",
  planning: "Planning",
  announcements: "Annonces",
  resources: "Salles & matériels",
  attendance: "Présences",
  trainers: "Formateurs",
  staff: "Personnel",
  grades: "Notes",
  reports: "Rapports",
  settings: "Paramètres"
};

const ACCESS_VIEWS = Object.keys(VIEW_LABELS);
const MANAGED_ACCESS_VIEWS = ACCESS_VIEWS.filter(view => view !== "settings");
const ROLE_OPTIONS = ["Administrateur", "Directeur", "Secrétaire", "Comptable", "Formateur", "Accueil", "Etudiant"];
const TUITION_MOTIF_KEYS = ["scolarite", "formation", "mensualite"];
const MAKEUP_MOTIF_KEY = "rattrapage";
const PASSING_SCORE_20 = 12;
const MAKEUP_FEE = 5000;
const TABLE_PAGE_SIZE = 25;
const tablePages = {};

function defaultPaymentMotifs() {
  return [
    { key: "scolarite", label: "Scolarité", amount: 0 },
    { key: "inscription", label: "Inscription", amount: 15000 },
    { key: "document", label: "Document", amount: 5000 },
    { key: "tenue", label: "Tenue", amount: 25000 },
    { key: "tshirt", label: "T-shirt", amount: 5000 },
    { key: "macaron", label: "Macaron", amount: 2000 },
    { key: MAKEUP_MOTIF_KEY, label: "Rattrapage", amount: MAKEUP_FEE }
  ];
}

function defaultDocumentTemplates() {
  return [
    {
      key: "attestation-inscription",
      title: "Attestation d'inscription",
      category: "Attestation",
      audience: "student",
      status: "active",
      locked: true,
      content: `Nous soussignés {{centre_nom}}, attestons que {{etudiant_nom}}, matricule {{matricule}}, est régulièrement inscrit(e) à la formation {{formation}}, promotion {{promotion}}, en {{type_cours}}.

La présente attestation est délivrée pour servir et valoir ce que de droit.

Fait à Lomé, le {{date}}.`
    },
    {
      key: "attestation-fin-formation",
      title: "Attestation de fin de formation",
      category: "Attestation",
      audience: "student",
      status: "active",
      locked: true,
      content: `Nous soussignés {{centre_nom}}, attestons que {{etudiant_nom}}, matricule {{matricule}}, a suivi la formation {{formation}} au sein de notre centre.

Cette attestation est établie sous réserve de la validation administrative et pédagogique du dossier.

Fait à Lomé, le {{date}}.`
    },
    {
      key: "reglement-interieur",
      title: "Règlement intérieur",
      category: "Règlement",
      audience: "general",
      status: "active",
      locked: true,
      content: `Le présent règlement intérieur fixe les conditions de conduite, de ponctualité, de discipline et de respect des biens du centre.

Chaque étudiant s'engage à respecter les horaires, le programme de formation, les consignes données par l'administration et les formateurs, ainsi que les modalités de paiement convenues.

Tout manquement grave peut entraîner des mesures disciplinaires après examen par l'administration.`
    },
    {
      key: "contrat-formation",
      title: "Contrat de formation",
      category: "Contrat",
      audience: "student",
      status: "active",
      locked: true,
      content: `Entre {{centre_nom}} et {{etudiant_nom}}, matricule {{matricule}}, il est convenu ce qui suit :

L'étudiant est inscrit à la formation {{formation}}, promotion {{promotion}}, en {{type_cours}}.

La scolarité convenue est de {{scolarite}}. Le reste scolarité à la date du document est de {{reste_scolarite}}.

L'étudiant s'engage à respecter le règlement intérieur, les horaires et les modalités de paiement. Le centre s'engage à assurer la formation selon le programme prévu.`
    },
    {
      key: "contrat-travail",
      title: "Contrat de travail",
      category: "Contrat",
      audience: "staff",
      status: "active",
      locked: true,
      content: `Entre {{centre_nom}} et {{beneficiaire_nom}}, occupant la fonction de {{fonction}}, il est établi le présent contrat de travail.

Le bénéficiaire s'engage à exercer ses missions avec ponctualité, confidentialité et professionnalisme.

Les conditions particulières de rémunération, d'horaires et de responsabilités sont définies par l'administration du centre.

Fait à Lomé, le {{date}}.`
    }
  ];
}

const seedState = () => ({
  center: {
    name: "CFP EREXIT",
    subtitle: "Centre de Formation Professionnelle",
    phone: "",
    email: "",
    address: "",
    logoData: "",
    stampData: ""
  },
  academicSettings: {
    activeYear: String(new Date().getFullYear()),
    archivedYears: []
  },
  securitySettings: {
    idleTimeoutMinutes: 30
  },
  users: [],
  passwordResetRequests: [],
  onlineRegistrationRequests: [],
  studentAccounts: [],
  onlinePayments: [],
  notifications: [],
  loginHistory: [],
  paymentMotifs: defaultPaymentMotifs(),
  documentTemplates: defaultDocumentTemplates(),
  auditLog: [],
  requiredDocuments: {
    student: ["Photo", "Pièce d'identité", "Contrat signé"],
    trainer: ["Photo", "Pièce d'identité", "Contrat signé", "Diplôme ou CV"],
    staff: ["Photo", "Pièce d'identité", "Contrat signé"]
  },
  students: [
    {
      id: 1,
      matricule: "ERX-2026-001",
      firstName: "Amina",
      lastName: "Traore",
      gender: "F",
      birthDate: "2003-04-18",
      phone: "+221 77 000 10 01",
      email: "amina@example.com",
      address: "Quartier Centre",
      emergencyName: "Mariam Traore",
      emergencyPhone: "+221 77 100 10 01",
      status: "actif"
    },
    {
      id: 2,
      matricule: "ERX-2026-002",
      firstName: "Moussa",
      lastName: "Diallo",
      gender: "M",
      birthDate: "2001-09-08",
      phone: "+221 77 000 10 02",
      email: "moussa@example.com",
      address: "Route Principale",
      emergencyName: "Oumar Diallo",
      emergencyPhone: "+221 77 100 10 02",
      status: "actif"
    },
    {
      id: 3,
      matricule: "ERX-2026-003",
      firstName: "Fatou",
      lastName: "Ndiaye",
      gender: "F",
      birthDate: "2002-02-22",
      phone: "+221 77 000 10 03",
      email: "fatou@example.com",
      address: "Cite Nouvelle",
      emergencyName: "Adama Ndiaye",
      emergencyPhone: "+221 77 100 10 03",
      status: "preinscrit"
    },
    {
      id: 4,
      matricule: "ERX-2026-004",
      firstName: "Jean",
      lastName: "Kouame",
      gender: "M",
      birthDate: "2000-12-14",
      phone: "+225 07 00 10 04",
      email: "jean@example.com",
      address: "Avenue de la Paix",
      emergencyName: "Claire Kouame",
      emergencyPhone: "+225 07 10 10 04",
      status: "actif"
    }
  ],
  courses: [
    {
      id: 1,
      code: "BUR",
      name: "Informatique bureautique",
      duration: "6 mois",
      description: "Word, Excel, PowerPoint, Internet et outils administratifs.",
      registrationFee: 15000,
      trainingFee: 120000,
      monthlyFee: 20000,
      status: "active"
    },
    {
      id: 2,
      code: "COMPTA",
      name: "Comptabilité pratique",
      duration: "8 mois",
      description: "Bases comptables, caisse, facturation et états financiers.",
      registrationFee: 20000,
      trainingFee: 160000,
      monthlyFee: 25000,
      status: "active"
    },
    {
      id: 3,
      code: "INFO",
      name: "Maintenance informatique",
      duration: "9 mois",
      description: "Matériel, systèmes, réseaux et dépannage.",
      registrationFee: 20000,
      trainingFee: 180000,
      monthlyFee: 30000,
      status: "active"
    }
  ],
  groups: [
    {
      id: 1,
      name: "Bureautique 2026 - Groupe A",
      courseId: 1,
      year: "2026",
      sessionType: "jour",
      trainer: "Mme Coulibaly",
      capacity: 25,
      startDate: "2026-01-12",
      endDate: "2026-07-12",
      status: "active"
    },
    {
      id: 2,
      name: "Comptabilité 2026 - Groupe A",
      courseId: 2,
      year: "2026",
      sessionType: "soir",
      trainer: "M. Diop",
      capacity: 20,
      startDate: "2026-02-03",
      endDate: "2026-10-03",
      status: "active"
    },
    {
      id: 3,
      name: "Maintenance 2026 - Groupe A",
      courseId: 3,
      year: "2026",
      sessionType: "jour",
      trainer: "M. Kone",
      capacity: 18,
      startDate: "2026-03-01",
      endDate: "2026-12-01",
      status: "active"
    }
  ],
  trainers: [
    {
      id: 1,
      firstName: "Awa",
      lastName: "Coulibaly",
      phone: "+228 90 00 00 01",
      email: "awa.coulibaly@cftperexit.com",
      specialty: "Bureautique",
      modules: "Word, Excel, PowerPoint",
      status: "actif"
    },
    {
      id: 2,
      firstName: "Mamadou",
      lastName: "Diop",
      phone: "+228 90 00 00 02",
      email: "mamadou.diop@cftperexit.com",
      specialty: "Comptabilite pratique",
      modules: "Caisse, facturation, etats financiers",
      status: "actif"
    },
    {
      id: 3,
      firstName: "Koffi",
      lastName: "Kone",
      phone: "+228 90 00 00 03",
      email: "koffi.kone@cftperexit.com",
      specialty: "Maintenance informatique",
      modules: "Materiel, systemes, reseaux",
      status: "actif"
    }
  ],
  staffMembers: [
    {
      id: 1,
      firstName: "Abla",
      lastName: "Kossibokon",
      role: "Comptable",
      phone: "",
      email: "",
      salary: 0,
      status: "actif"
    }
  ],
  enrollments: [
    {
      id: 1,
      studentId: 1,
      courseId: 1,
      groupId: 1,
      date: "2026-01-13",
      totalAmount: 135000,
      discountAmount: 0,
      finalAmount: 135000,
      status: "validee"
    },
    {
      id: 2,
      studentId: 2,
      courseId: 2,
      groupId: 2,
      date: "2026-02-05",
      totalAmount: 180000,
      discountAmount: 10000,
      finalAmount: 170000,
      status: "validee"
    },
    {
      id: 3,
      studentId: 3,
      courseId: 1,
      groupId: 1,
      date: "2026-03-02",
      totalAmount: 135000,
      discountAmount: 0,
      finalAmount: 135000,
      status: "en attente"
    },
    {
      id: 4,
      studentId: 4,
      courseId: 3,
      groupId: 3,
      date: "2026-03-10",
      totalAmount: 200000,
      discountAmount: 0,
      finalAmount: 200000,
      status: "validee"
    }
  ],
  payments: [
    {
      id: 1,
      enrollmentId: 1,
      receiptNumber: "REC-2026-001",
      amount: 35000,
      method: "Espèce",
      reason: "Frais d'inscription",
      date: "2026-01-13",
      receivedBy: "Comptable"
    },
    {
      id: 2,
      enrollmentId: 1,
      receiptNumber: "REC-2026-002",
      amount: 20000,
      method: "Mobile Money",
      reason: "Mensualité",
      date: "2026-02-12",
      receivedBy: "Comptable"
    },
    {
      id: 3,
      enrollmentId: 2,
      receiptNumber: "REC-2026-003",
      amount: 50000,
      method: "Espèce",
      reason: "Frais d'inscription",
      date: "2026-02-05",
      receivedBy: "Comptable"
    },
    {
      id: 4,
      enrollmentId: 4,
      receiptNumber: "REC-2026-004",
      amount: 60000,
      method: "Virement",
      reason: "Formation",
      date: "2026-03-11",
      receivedBy: "Comptable"
    }
  ],
  paymentAuditLog: [],
  cashEntries: [],
  staffPayments: [],
  attendanceSessions: [
    {
      id: 1,
      groupId: 1,
      date: "2026-04-02",
      topic: "Traitement de texte",
      records: [
        { studentId: 1, status: "present" },
        { studentId: 3, status: "absent" }
      ]
    }
  ],
  trainerAttendanceSessions: [],
  evaluations: [
    {
      id: 1,
      groupId: 1,
      trainerId: 1,
      title: "Evaluation Word",
      type: "pratique",
      date: "2026-04-15",
      maxScore: 20,
      grades: [
        { studentId: 1, score: 16, appreciation: "Bon travail" },
        { studentId: 3, score: 12, appreciation: "A renforcer" }
      ]
    }
  ]
});

let state = loadState();
let currentView = "dashboard";

const ids = {
  pageTitle: document.getElementById("pageTitle"),
  toast: document.getElementById("toast"),
  saveStatus: document.getElementById("saveStatus"),
  loginScreen: document.getElementById("loginScreen"),
  appShell: document.getElementById("appShell"),
  loginChoiceView: document.getElementById("loginChoiceView"),
  publicRegistration: document.getElementById("publicRegistration"),
  onlineRegistrationForm: document.getElementById("onlineRegistrationForm"),
  onlineCourse: document.getElementById("onlineCourse"),
  onlineRegistrationError: document.getElementById("onlineRegistrationError"),
  onlineRegistrationSuccess: document.getElementById("onlineRegistrationSuccess"),
  studentPortal: document.getElementById("studentPortal"),
  studentPortalLoginError: document.getElementById("studentPortalLoginError"),
  studentPortalName: document.getElementById("studentPortalName"),
  studentPortalMeta: document.getElementById("studentPortalMeta"),
  studentPortalSummary: document.getElementById("studentPortalSummary"),
  studentPortalInfo: document.getElementById("studentPortalInfo"),
  studentPortalNotifications: document.getElementById("studentPortalNotifications"),
  studentPortalEnrollments: document.getElementById("studentPortalEnrollments"),
  studentPortalPayments: document.getElementById("studentPortalPayments"),
  studentPortalGrades: document.getElementById("studentPortalGrades"),
  studentPortalAttendance: document.getElementById("studentPortalAttendance"),
  statsGrid: document.getElementById("statsGrid"),
  recentPaymentsTable: document.getElementById("recentPaymentsTable"),
  balancesTable: document.getElementById("balancesTable"),
  paymentAlertsTable: document.getElementById("paymentAlertsTable"),
  paymentAlertCount: document.getElementById("paymentAlertCount"),
  activeYearLabel: document.getElementById("activeYearLabel"),
  advancedStatsGrid: document.getElementById("advancedStatsGrid"),
  advancedStatsDetails: document.getElementById("advancedStatsDetails"),
  notificationSummary: document.getElementById("notificationSummary"),
  notificationCount: document.getElementById("notificationCount"),
  notificationNavCount: document.getElementById("notificationNavCount"),
  notificationsTable: document.getElementById("notificationsTable"),
  planningSummary: document.getElementById("planningSummary"),
  planningCount: document.getElementById("planningCount"),
  planningTable: document.getElementById("planningTable"),
  announcementCount: document.getElementById("announcementCount"),
  announcementsTable: document.getElementById("announcementsTable"),
  roomCount: document.getElementById("roomCount"),
  roomsTable: document.getElementById("roomsTable"),
  equipmentCount: document.getElementById("equipmentCount"),
  equipmentTable: document.getElementById("equipmentTable"),
  printPreviewModal: document.getElementById("printPreviewModal"),
  printPreviewBody: document.getElementById("printPreviewBody"),
  printPreviewTitle: document.getElementById("printPreviewTitle"),
  printPreviewPrint: document.getElementById("printPreviewPrint"),
  passwordChangeModal: document.getElementById("passwordChangeModal"),
  passwordChangeForm: document.getElementById("passwordChangeForm"),
  currentPasswordChange: document.getElementById("currentPasswordChange"),
  newPasswordChange: document.getElementById("newPasswordChange"),
  confirmPasswordChange: document.getElementById("confirmPasswordChange"),
  passwordChangeError: document.getElementById("passwordChangeError"),
  studentsTable: document.getElementById("studentsTable"),
  studentCount: document.getElementById("studentCount"),
  studentPhotoPreview: document.getElementById("studentPhotoPreview"),
  studentDocumentList: document.getElementById("studentDocumentList"),
  onlineRequestsTable: document.getElementById("onlineRequestsTable"),
  onlineRequestCount: document.getElementById("onlineRequestCount"),
  coursesTable: document.getElementById("coursesTable"),
  courseCount: document.getElementById("courseCount"),
  groupsTable: document.getElementById("groupsTable"),
  groupCount: document.getElementById("groupCount"),
  enrollmentsTable: document.getElementById("enrollmentsTable"),
  enrollmentCount: document.getElementById("enrollmentCount"),
  paymentsTable: document.getElementById("paymentsTable"),
  paymentCount: document.getElementById("paymentCount"),
  paymentBalance: document.getElementById("paymentBalance"),
  paymentAuditTable: document.getElementById("paymentAuditTable"),
  paymentAuditCount: document.getElementById("paymentAuditCount"),
  cashTable: document.getElementById("cashTable"),
  cashCount: document.getElementById("cashCount"),
  cashBalance: document.getElementById("cashBalance"),
  dashboardFinanceBars: document.getElementById("dashboardFinanceBars"),
  dashboardTuitionRing: document.getElementById("dashboardTuitionRing"),
  dashboardTuitionDetails: document.getElementById("dashboardTuitionDetails"),
  dashboardCourseBars: document.getElementById("dashboardCourseBars"),
  attendanceList: document.getElementById("attendanceList"),
  attendanceTable: document.getElementById("attendanceTable"),
  attendanceTotal: document.getElementById("attendanceTotal"),
  attendanceCount: document.getElementById("attendanceCount"),
  trainerAttendanceList: document.getElementById("trainerAttendanceList"),
  trainerAttendanceTable: document.getElementById("trainerAttendanceTable"),
  trainerAttendanceTotal: document.getElementById("trainerAttendanceTotal"),
  trainerAttendanceCount: document.getElementById("trainerAttendanceCount"),
  trainersTable: document.getElementById("trainersTable"),
  trainerCount: document.getElementById("trainerCount"),
  trainerPhotoPreview: document.getElementById("trainerPhotoPreview"),
  trainerDocumentList: document.getElementById("trainerDocumentList"),
  staffTable: document.getElementById("staffTable"),
  staffCount: document.getElementById("staffCount"),
  staffPhotoPreview: document.getElementById("staffPhotoPreview"),
  staffDocumentList: document.getElementById("staffDocumentList"),
  staffPaymentStaff: document.getElementById("staffPaymentStaff"),
  staffPaymentsTable: document.getElementById("staffPaymentsTable"),
  staffPaymentCount: document.getElementById("staffPaymentCount"),
  staffPaymentTotal: document.getElementById("staffPaymentTotal"),
  gradeStudentSearch: document.getElementById("gradeStudentSearch"),
  gradeStudentResults: document.getElementById("gradeStudentResults"),
  studentGradeEnrollment: document.getElementById("studentGradeEnrollment"),
  studentGradeHistoryTable: document.getElementById("studentGradeHistoryTable"),
  studentGradeDecision: document.getElementById("studentGradeDecision"),
  gradeEntryList: document.getElementById("gradeEntryList"),
  evaluationsTable: document.getElementById("evaluationsTable"),
  evaluationCount: document.getElementById("evaluationCount"),
  financialReport: document.getElementById("financialReport"),
  reportBalancesTable: document.getElementById("reportBalancesTable"),
  courseDistribution: document.getElementById("courseDistribution"),
  monthlyScheduleTable: document.getElementById("monthlyScheduleTable"),
  monthlyScheduleCount: document.getElementById("monthlyScheduleCount"),
  documentGeneratorTemplate: document.getElementById("documentGeneratorTemplate"),
  documentGeneratorStudent: document.getElementById("documentGeneratorStudent"),
  documentGeneratorBeneficiary: document.getElementById("documentGeneratorBeneficiary"),
  individualReportStudent: document.getElementById("individualReportStudent"),
  individualReportSummary: document.getElementById("individualReportSummary"),
  individualMotifTable: document.getElementById("individualMotifTable"),
  printIndividualReport: document.getElementById("printIndividualReport"),
  previewIndividualReportPdf: document.getElementById("previewIndividualReportPdf"),
  printStudentTranscript: document.getElementById("printStudentTranscript"),
  printArea: document.getElementById("printArea"),
  currentUserName: document.getElementById("currentUserName"),
  loginError: document.getElementById("loginError"),
  passwordResetBox: document.getElementById("passwordResetBox"),
  passwordResetEmail: document.getElementById("passwordResetEmail"),
  passwordResetMessage: document.getElementById("passwordResetMessage"),
  centerLogoPreview: document.getElementById("centerLogoPreview"),
  centerStampPreview: document.getElementById("centerStampPreview"),
  securitySettingsForm: document.getElementById("securitySettingsForm"),
  idleTimeoutMinutes: document.getElementById("idleTimeoutMinutes"),
  academicYearForm: document.getElementById("academicYearForm"),
  activeAcademicYear: document.getElementById("activeAcademicYear"),
  archivedAcademicYears: document.getElementById("archivedAcademicYears"),
  paymentMotifsSettings: document.getElementById("paymentMotifsSettings"),
  courseFeesSettings: document.getElementById("courseFeesSettings"),
  documentTemplateList: document.getElementById("documentTemplateList"),
  documentTemplateEditKey: document.getElementById("documentTemplateEditKey"),
  documentTemplateTitle: document.getElementById("documentTemplateTitle"),
  documentTemplateCategory: document.getElementById("documentTemplateCategory"),
  documentTemplateAudience: document.getElementById("documentTemplateAudience"),
  documentTemplateStatus: document.getElementById("documentTemplateStatus"),
  documentTemplateContent: document.getElementById("documentTemplateContent"),
  userAccessSettings: document.getElementById("userAccessSettings"),
  passwordResetRequests: document.getElementById("passwordResetRequests"),
  loginHistoryTable: document.getElementById("loginHistoryTable"),
  loginHistoryCount: document.getElementById("loginHistoryCount"),
  auditLogTable: document.getElementById("auditLogTable"),
  auditLogCount: document.getElementById("auditLogCount"),
  requiredDocumentsSettings: document.getElementById("requiredDocumentsSettings"),
  cleanupModeStatus: document.getElementById("cleanupModeStatus")
};

function loadState() {
  if (SERVER_MODE) {
    return seedState();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return seedState();
  }
  try {
    return { ...seedState(), ...JSON.parse(raw) };
  } catch {
    return seedState();
  }
}

function saveTimestamp() {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function setSaveStatus(text, status = "") {
  if (!ids.saveStatus) return;
  ids.saveStatus.textContent = text;
  ids.saveStatus.className = `save-status ${status}`.trim();
}

function markSaved() {
  lastSavedAt = saveTimestamp();
  hasPendingChanges = false;
  setSaveStatus(`Sauvegardé ${lastSavedAt}`, "saved");
}

function cloneStateSnapshot(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function isCleanupModeActive() {
  return isAdmin() && Number(sessionStorage.getItem(CLEANUP_MODE_KEY) || 0) > Date.now();
}

function setCleanupModeStatus() {
  if (!ids.cleanupModeStatus) return;
  if (!isAdmin()) {
    ids.cleanupModeStatus.textContent = "Réservé à l'administrateur";
    return;
  }
  if (!isCleanupModeActive()) {
    ids.cleanupModeStatus.textContent = "Nettoyage test désactivé";
    return;
  }
  const until = new Date(Number(sessionStorage.getItem(CLEANUP_MODE_KEY)));
  ids.cleanupModeStatus.textContent = `Nettoyage test actif jusqu'à ${new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(until)}`;
}

function enableCleanupMode() {
  if (!isAdmin()) {
    showToast("Accès réservé à l'administrateur");
    return;
  }
  const confirmation = prompt("Mode nettoyage test : tapez NETTOYAGE pour autoriser les suppressions liées pendant 30 minutes.");
  if (confirmation !== "NETTOYAGE") {
    showToast("Nettoyage test non activé");
    return;
  }
  sessionStorage.setItem(CLEANUP_MODE_KEY, String(Date.now() + 30 * 60 * 1000));
  setCleanupModeStatus();
  updateStudentMatriculeLock();
  showToast("Nettoyage test actif pendant 30 minutes");
}

function updateStudentMatriculeLock() {
  const input = document.getElementById("studentMatricule");
  const form = document.getElementById("studentForm");
  if (!input || !form) return;
  const canEdit = !!form.dataset.editId && isCleanupModeActive();
  input.readOnly = !canEdit;
  input.title = canEdit
    ? "Nettoyage test actif : matricule modifiable"
    : "Matricule généré automatiquement";
}

function applyServerState(nextState) {
  state = { ...seedState(), ...(nextState || {}) };
  serverRevision = String(state.updatedAt || "");
  lastSyncedState = cloneStateSnapshot(state);
}

function stopServerSync() {
  if (syncTimer) {
    window.clearInterval(syncTimer);
    syncTimer = null;
  }
}

function startServerSync() {
  if (!SERVER_MODE) return;
  stopServerSync();
  syncTimer = window.setInterval(() => {
    refreshServerState({ silent: true });
  }, 30000);
}

function idleTimeoutMs() {
  return normalizeSecuritySettings(state.securitySettings).idleTimeoutMinutes * 60 * 1000;
}

function recordIdleActivity() {
  lastIdleActivityAt = Date.now();
  scheduleIdleLogout();
}

function stopIdleLogoutTimer() {
  if (idleLogoutTimer) {
    window.clearTimeout(idleLogoutTimer);
    idleLogoutTimer = null;
  }
}

function startIdleLogoutTimer() {
  if (!SERVER_MODE || !currentUser || PUBLIC_REGISTRATION_MODE || studentPortalData) return;
  lastIdleActivityAt = Date.now();
  scheduleIdleLogout();
}

function scheduleIdleLogout() {
  stopIdleLogoutTimer();
  if (!SERVER_MODE || !currentUser || PUBLIC_REGISTRATION_MODE || studentPortalData) return;
  const remaining = Math.max(1000, idleTimeoutMs() - (Date.now() - lastIdleActivityAt));
  idleLogoutTimer = window.setTimeout(handleIdleLogout, remaining);
}

async function handleIdleLogout() {
  if (!SERVER_MODE || !currentUser) return;
  if (Date.now() - lastIdleActivityAt < idleTimeoutMs()) {
    scheduleIdleLogout();
    return;
  }
  try {
    if (hasPendingChanges) {
      await persistStateNow({ notify: false });
    }
  } catch {
    // La déconnexion reste prioritaire si la sauvegarde ne répond plus.
  }
  showToast("Session fermée après inactivité");
  await logout({ reason: "idle" });
}

function isEditingField() {
  const active = document.activeElement;
  return !!active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
}

async function refreshServerState({ silent = false } = {}) {
  if (!SERVER_MODE || !currentUser || hasPendingChanges || isEditingField()) return;
  try {
    const latest = await apiRequest("/api/state");
    const latestRevision = String(latest.updatedAt || "");
    if (latestRevision && latestRevision !== serverRevision) {
      applyServerState(latest);
      render();
      markSaved();
      if (!silent) showToast("Dernière version chargée");
    }
  } catch {
    if (!silent) showToast("Actualisation impossible");
  }
}

function handleSaveConflict(error) {
  if (error.status !== 409) return false;
  if (error.payload?.state) {
    applyServerState(error.payload.state);
    render();
  }
  hasPendingChanges = false;
  setSaveStatus("Données actualisées", "error");
  showToast("Une autre personne a modifié les données. Dernière version rechargée, recommence l'action.");
  return true;
}

async function persistStateCore({ notify = false } = {}) {
  if (!SERVER_MODE) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markSaved();
    refreshDashboardAfterDataChange();
    if (notify) showToast("Données sauvegardées");
    return true;
  }

  if (!currentUser) return false;
  const saveVersion = localChangeVersion;
  const snapshot = cloneStateSnapshot(state);
  const snapshotRevision = serverRevision;
  setSaveStatus("Sauvegarde en cours...", "saving");
  try {
    const result = await apiRequest("/api/state", {
      method: "PUT",
      body: JSON.stringify({
        ...snapshot,
        clientRevision: snapshotRevision
      })
    });
    if (result.state) {
      if (localChangeVersion === saveVersion) {
        applyServerState(result.state);
        render();
      } else {
        serverRevision = String(result.updatedAt || result.state.updatedAt || serverRevision);
        lastSyncedState = cloneStateSnapshot(result.state);
      }
    } else {
      serverRevision = String(result.updatedAt || state.updatedAt || serverRevision);
      if (localChangeVersion === saveVersion) {
        state.updatedAt = serverRevision || state.updatedAt;
      }
    }
    if (localChangeVersion === saveVersion) {
      markSaved();
      refreshDashboardAfterDataChange();
    } else {
      hasPendingChanges = true;
      setSaveStatus("Modifications en attente...", "saving");
    }
    if (notify) showToast("Données sauvegardées");
    return true;
  } catch (error) {
    if (handleSaveConflict(error)) return false;
    const message = error?.message || "Sauvegarde serveur impossible";
    setSaveStatus("Sauvegarde impossible", "error");
    showToast(message);
    return false;
  }
}

function persistStateNow(options = {}) {
  const task = saveChain.then(() => persistStateCore(options));
  saveChain = task.catch(() => false);
  return task;
}

function saveState(options = {}) {
  const { immediate = false, notify = false } = options;
  window.clearTimeout(saveTimer);
  localChangeVersion += 1;
  hasPendingChanges = true;
  if (immediate) {
    return persistStateNow({ notify });
  }
  setSaveStatus("Modifications en attente...", "saving");
  saveTimer = window.setTimeout(() => {
    persistStateNow({ notify });
  }, 250);
}

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
  } catch {
    throw new Error("Serveur inaccessible. Lancez l'application avec le serveur Node.js puis ouvrez http://localhost:3000.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Erreur serveur");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadServerState() {
  applyServerState(await apiRequest("/api/state"));
  markSaved();
}

async function loadPublicCenterIdentity() {
  if (!SERVER_MODE) return;
  try {
    const result = await apiRequest("/api/public-center");
    if (result.center) {
      state.center = { ...state.center, ...result.center };
      renderCenterIdentity();
    }
  } catch {
    renderCenterIdentity();
  }
}

function ensurePaymentMotifs() {
  const defaults = defaultPaymentMotifs();
  if (!Array.isArray(state.paymentMotifs)) {
    state.paymentMotifs = defaults;
    return;
  }

  defaults.forEach(defaultMotif => {
    const existing = state.paymentMotifs.find(motif => motif.key === defaultMotif.key);
    if (!existing) {
      if (defaultMotif.key === "scolarite") {
        state.paymentMotifs.unshift(defaultMotif);
      } else {
        state.paymentMotifs.push(defaultMotif);
      }
      return;
    }
    existing.label ||= defaultMotif.label;
    existing.amount = Number(existing.amount || 0);
  });
}

function ensureDocumentTemplates() {
  const defaults = defaultDocumentTemplates();
  if (!Array.isArray(state.documentTemplates)) {
    state.documentTemplates = defaults;
    return;
  }

  defaults.forEach(defaultTemplate => {
    const existing = state.documentTemplates.find(template => template.key === defaultTemplate.key);
    if (!existing) {
      state.documentTemplates.push(defaultTemplate);
      return;
    }
    existing.title ||= defaultTemplate.title;
    existing.category ||= defaultTemplate.category;
    existing.audience ||= defaultTemplate.audience;
    existing.status ||= "active";
    existing.locked = existing.locked !== false;
    existing.content ||= defaultTemplate.content;
  });
}

function ensureCollections() {
  state.academicSettings = normalizeAcademicSettings(state.academicSettings);
  state.securitySettings = normalizeSecuritySettings(state.securitySettings);
  state.trainers = Array.isArray(state.trainers) ? state.trainers : [];
  state.evaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
  state.cashEntries = Array.isArray(state.cashEntries) ? state.cashEntries : [];
  state.paymentAuditLog = Array.isArray(state.paymentAuditLog) ? state.paymentAuditLog : [];
  state.attendanceSessions = Array.isArray(state.attendanceSessions) ? state.attendanceSessions : [];
  state.trainerAttendanceSessions = Array.isArray(state.trainerAttendanceSessions) ? state.trainerAttendanceSessions : [];
  state.users = Array.isArray(state.users) ? state.users : [];
  state.passwordResetRequests = Array.isArray(state.passwordResetRequests) ? state.passwordResetRequests : [];
  state.onlineRegistrationRequests = Array.isArray(state.onlineRegistrationRequests) ? state.onlineRegistrationRequests : [];
  state.studentAccounts = Array.isArray(state.studentAccounts) ? state.studentAccounts : [];
  state.onlinePayments = Array.isArray(state.onlinePayments) ? state.onlinePayments : [];
  state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
  state.planningEvents = Array.isArray(state.planningEvents) ? state.planningEvents : [];
  state.announcements = Array.isArray(state.announcements) ? state.announcements : [];
  state.rooms = Array.isArray(state.rooms) ? state.rooms : [];
  state.equipment = Array.isArray(state.equipment) ? state.equipment : [];
  state.loginHistory = Array.isArray(state.loginHistory) ? state.loginHistory : [];
  state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
  state.requiredDocuments = normalizeRequiredDocuments(state.requiredDocuments);
  state.courses = Array.isArray(state.courses) ? state.courses : [];
  state.staffMembers = Array.isArray(state.staffMembers) ? state.staffMembers : [];
  state.staffPayments = Array.isArray(state.staffPayments) ? state.staffPayments : [];
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  ensureDocumentTemplates();
  state.users.forEach(user => {
    user.email = migrateEmailDomain(user.email);
  });
  state.trainers.forEach(trainer => {
    trainer.email = migrateEmailDomain(trainer.email);
  });
  [...state.students, ...state.trainers, ...state.staffMembers].forEach(person => {
    if (!person) return;
    person.photoData ||= "";
    person.documents = Array.isArray(person.documents) ? person.documents : [];
  });
  state.students.forEach(student => {
    student.matricule ||= generateMatricule(yearFromDate(student.createdAt || today()));
    student.lastName = String(student.lastName || "").toUpperCase();
    student.phone2 ||= student.secondaryPhone || "";
    student.documentStatus ||= personDocumentCompletion(student, "student").completed ? "valide" : "manquant";
    student.documentObservation ||= "";
    student.status ||= "preinscrit";
    student.createdAt ||= new Date().toISOString();
    student.updatedAt ||= student.createdAt;
    student.createdBy ||= "Migration";
    student.updatedBy ||= student.createdBy;
  });
  state.courses.forEach(course => {
    syncCourseBaseFees(course);
    ensureCourseVersions(course);
  });
  state.enrollments.forEach(enrollment => {
    const group = getGroup(enrollment.groupId);
    const course = getCourse(enrollment.courseId);
    const version = getCourseVersion(course, enrollment.versionId || enrollment.formationVersionId) || activeCourseVersion(course);
    enrollment.versionId ||= version?.id || "";
    enrollment.formationVersionId ||= enrollment.versionId;
    enrollment.status = normalizeEnrollmentStatus(enrollment.status || "en attente");
    enrollment.courseType ||= group?.sessionType || "jour";
    enrollment.academicYear ||= group?.year || yearFromDate(enrollment.date || today());
    enrollment.registrationFee = Number(enrollment.registrationFee ?? course?.registrationFee ?? 0);
    enrollment.monthlyFee = Number(enrollment.monthlyFee || course?.monthlyFee || 0);
    enrollment.totalAmount = Number(enrollment.totalAmount || courseCost(course) || 0);
    enrollment.discountAmount = Number(enrollment.discountAmount || 0);
    enrollment.finalAmount = Number(enrollment.finalAmount ?? Math.max(0, enrollment.totalAmount - enrollment.discountAmount));
    enrollment.observation ||= "";
    enrollment.createdAt ||= new Date().toISOString();
    enrollment.updatedAt ||= enrollment.createdAt;
    enrollment.createdBy ||= "Migration";
    enrollment.updatedBy ||= enrollment.createdBy;
    const copiedFees = normalizeEnrollmentCopiedFees(enrollment);
    enrollment.enrollmentFees = copiedFees;
    enrollment.totalScolarite = copiedFees.filter(isTuitionFee).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0);
    enrollment.totalFraisAnnexes = copiedFees.filter(fee => !isTuitionFee(fee) && fee.required).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0);
    enrollment.totalGeneral = Number(enrollment.totalScolarite || 0) + Number(enrollment.totalFraisAnnexes || 0);
  });
  state.groups.forEach(group => {
    group.sessionType ||= "jour";
    const course = getCourse(group.courseId);
    group.versionId ||= activeCourseVersion(course)?.id || "";
    group.formationVersionId ||= group.versionId;
  });
}

function normalizeAcademicSettings(value = {}) {
  const currentYear = String(new Date().getFullYear());
  const activeYear = String(value?.activeYear || currentYear).replace(/[^\d]/g, "").slice(0, 4) || currentYear;
  const rawArchives = Array.isArray(value?.archivedYears)
    ? value.archivedYears
    : String(value?.archivedYears || "").split(/[,\s;]+/);
  const archivedYears = [...new Set(rawArchives
    .map(year => String(year || "").replace(/[^\d]/g, "").slice(0, 4))
    .filter(year => /^\d{4}$/.test(year) && year !== activeYear))]
    .sort((a, b) => Number(b) - Number(a));
  return { activeYear, archivedYears };
}

function normalizeSecuritySettings(value = {}) {
  const minutes = Number(value?.idleTimeoutMinutes || 30);
  return {
    idleTimeoutMinutes: Math.max(1, Math.min(480, Number.isFinite(minutes) ? Math.round(minutes) : 30))
  };
}

function normalizeRequiredDocuments(value = {}) {
  const defaults = seedState().requiredDocuments;
  return {
    student: Array.isArray(value.student) && value.student.length ? value.student : defaults.student,
    trainer: Array.isArray(value.trainer) && value.trainer.length ? value.trainer : defaults.trainer,
    staff: Array.isArray(value.staff) && value.staff.length ? value.staff : defaults.staff
  };
}

function migrateEmailDomain(email) {
  return String(email || "").replace(/@erexit\.local$/i, "@cftperexit.com");
}

function isAdmin() {
  if (SERVER_MODE) return roleCode(currentUser?.role) === "administrateur";
  return roleCode(document.getElementById("roleSelect")?.value) === "administrateur";
}

function defaultPermissionsForRole(role) {
  const code = roleCode(role);
  if (code === "administrateur" || code === "admin") return [...ACCESS_VIEWS];
  if (code === "directeur") {
    return ["dashboard", "onlineRequests", "students", "courses", "groups", "enrollments", "payments", "cash", "notifications", "planning", "announcements", "resources", "attendance", "trainers", "staff", "grades", "reports"];
  }
  if (code === "secretaire") {
    return ["dashboard", "onlineRequests", "students", "courses", "groups", "enrollments", "notifications", "planning", "announcements", "resources", "attendance", "trainers"];
  }
  if (code === "comptable") {
    return ["dashboard", "students", "courses", "groups", "enrollments", "payments", "cash", "notifications", "planning", "announcements", "resources", "staff", "reports"];
  }
  if (code === "formateur") {
    return ["dashboard", "students", "courses", "groups", "notifications", "planning", "announcements", "resources", "attendance", "grades"];
  }
  if (code === "accueil") {
    return ["dashboard", "onlineRequests", "students", "courses", "groups", "enrollments", "notifications", "planning", "announcements", "resources"];
  }
  if (code === "etudiant") {
    return [];
  }
  return ["dashboard"];
}

function permissionsForUser(user = currentUser) {
  if (!SERVER_MODE) return [...ACCESS_VIEWS];
  if (!user) return [];
  if (roleCode(user.role) === "administrateur" || roleCode(user.role) === "admin") return [...ACCESS_VIEWS];
  const permissions = Array.isArray(user.permissions) && user.permissions.length
    ? user.permissions
    : defaultPermissionsForRole(user.role);
  return permissions.filter(view => MANAGED_ACCESS_VIEWS.includes(view));
}

function canAccessView(view) {
  if (!SERVER_MODE) return true;
  if (view === "settings") return isAdmin();
  return isAdmin() || permissionsForUser().includes(view);
}

function canControlPayments() {
  return isAdmin();
}

function currentOperatorName() {
  return currentUser?.name || document.getElementById("roleSelect")?.value || "Administrateur";
}

function firstAllowedView() {
  return ACCESS_VIEWS.find(view => canAccessView(view)) || "dashboard";
}

function getPaymentMotif(key) {
  const enrollmentFee = enrollmentFeeFromKey(key);
  if (enrollmentFee) {
    return {
      key,
      label: enrollmentFee.label,
      amount: Number(enrollmentFee.amountFinal ?? enrollmentFee.amount ?? 0),
      category: enrollmentFee.category,
      enrollmentFee
    };
  }
  const courseFee = courseFeeFromKey(key);
  if (courseFee) {
    return {
      key,
      label: courseFee.label,
      amount: Number(courseFee.amount || 0),
      category: courseFee.category,
      courseFee
    };
  }
  ensurePaymentMotifs();
  return state.paymentMotifs.find(motif => motif.key === key);
}

function yearFromDate(value = today()) {
  return String(value || today()).slice(0, 4);
}

function currentAcademicYear() {
  return normalizeAcademicSettings(state.academicSettings).activeYear;
}

function archivedAcademicYears() {
  return normalizeAcademicSettings(state.academicSettings).archivedYears;
}

function enrollmentAcademicYear(enrollment) {
  if (!enrollment) return currentAcademicYear();
  const group = getGroup(enrollment.groupId);
  return String(enrollment.academicYear || group?.year || yearFromDate(enrollment.date || today()));
}

function enrollmentsForAcademicYear(year = currentAcademicYear()) {
  const targetYear = String(year);
  return state.enrollments.filter(enrollment => enrollmentAcademicYear(enrollment) === targetYear);
}

function paymentsForAcademicYear(year = currentAcademicYear()) {
  const targetYear = String(year);
  return state.payments.filter(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    return enrollment
      ? enrollmentAcademicYear(enrollment) === targetYear
      : yearFromDate(payment.date || today()) === targetYear;
  });
}

function cashEntriesForAcademicYear(year = currentAcademicYear()) {
  const targetYear = String(year);
  return state.cashEntries.filter(entry => yearFromDate(entry.date || today()) === targetYear);
}

function staffPaymentsForAcademicYear(year = currentAcademicYear()) {
  const targetYear = String(year);
  return state.staffPayments.filter(payment => yearFromDate(payment.date || today()) === targetYear);
}

function studentIdsForAcademicYear(year = currentAcademicYear()) {
  return new Set(enrollmentsForAcademicYear(year).map(enrollment => Number(enrollment.studentId)).filter(Boolean));
}

function randomFiveDigits() {
  return String(Math.floor(Math.random() * 100000)).padStart(5, "0");
}

function generateMatricule(year = yearFromDate()) {
  let matricule = "";
  do {
    matricule = `ERX-${year}-${randomFiveDigits()}`;
  } while (state.students.some(student => student.matricule === matricule));
  return matricule;
}

function nextId(collection) {
  return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("fr-FR").format(Number(value) || 0)} FCFA`;
}

function amountToWords(value) {
  const units = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
  const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
  const underHundred = number => {
    if (number < 17) return units[number];
    if (number < 20) return `dix-${units[number - 10]}`;
    if (number < 70) {
      const ten = Math.floor(number / 10);
      const unit = number % 10;
      return unit === 0 ? tens[ten] : `${tens[ten]}-${unit === 1 ? "et-" : ""}${units[unit]}`;
    }
    if (number < 80) return `soixante-${underHundred(number - 60)}`;
    if (number < 100) return number === 80 ? "quatre-vingts" : `quatre-vingt-${underHundred(number - 80)}`;
    return "";
  };
  const underThousand = number => {
    if (number < 100) return underHundred(number);
    const hundred = Math.floor(number / 100);
    const rest = number % 100;
    const prefix = hundred === 1 ? "cent" : `${units[hundred]} cent`;
    return rest ? `${prefix} ${underHundred(rest)}` : prefix;
  };
  const integer = Math.max(0, Math.floor(Number(value) || 0));
  if (integer === 0) return "zero franc CFA";
  const groups = [
    { value: 1000000000, label: "milliard" },
    { value: 1000000, label: "million" },
    { value: 1000, label: "mille" }
  ];
  let remaining = integer;
  const parts = [];
  groups.forEach(group => {
    const count = Math.floor(remaining / group.value);
    if (!count) return;
    parts.push(group.label === "mille" && count === 1 ? "mille" : `${underThousand(count)} ${group.label}${count > 1 && group.label !== "mille" ? "s" : ""}`);
    remaining %= group.value;
  });
  if (remaining) parts.push(underThousand(remaining));
  return `${parts.join(" ")} franc${integer > 1 ? "s" : ""} CFA`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
}

function statValueHtml(item) {
  if (item.type === "money") {
    return `
      <strong class="stat-value money">
        <span class="money-number">${formatNumber(item.value)}</span>
        <span class="money-currency">FCFA</span>
      </strong>
    `;
  }
  if (item.type === "text") {
    return `<strong class="stat-value count">${escapeHtml(item.value)}</strong>`;
  }
  return `<strong class="stat-value count">${formatNumber(item.value)}</strong>`;
}

function formatCompactMoney(value) {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `${formatNumber(Math.round(amount / 100000) / 10)} M`;
  if (abs >= 1000) return `${formatNumber(Math.round(amount / 1000))} k`;
  return formatNumber(amount);
}

function formatPrintAmount(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  if (size >= 1024) return `${Math.round(size / 1024)} Ko`;
  return `${size} o`;
}

function cloneDocuments(documents = []) {
  return JSON.parse(JSON.stringify(Array.isArray(documents) ? documents : []));
}

function resetPersonFileDraft(kind, person = {}) {
  personFileDrafts[kind] = {
    photoData: person.photoData || "",
    documents: cloneDocuments(person.documents)
  };
  renderPersonFileDraft(kind);
}

function personFilesPayload(kind) {
  return {
    photoData: personFileDrafts[kind]?.photoData || "",
    documents: cloneDocuments(personFileDrafts[kind]?.documents || [])
  };
}

function personPhotoHtml(person, label = "Photo") {
  const src = normalizeLogoData(person?.photoData || "");
  return src
    ? `<img class="person-avatar" src="${escapeHtml(src)}" alt="${escapeHtml(label)}">`
    : `<span class="person-avatar placeholder">${escapeHtml(label.slice(0, 2).toUpperCase())}</span>`;
}

function personDocumentSummary(person) {
  const count = Array.isArray(person?.documents) ? person.documents.length : 0;
  return count ? `${count} fichier(s)` : "Aucun fichier";
}

function requiredDocumentsFor(kind) {
  return normalizeRequiredDocuments(state.requiredDocuments)[kind] || [];
}

function documentLabelMatchesRequirement(documentItem, requiredLabel) {
  const required = normalizeSearchText(requiredLabel);
  const documentLabel = normalizeSearchText([
    documentItem?.type,
    documentItem?.name,
    documentItem?.originalName
  ].filter(Boolean).join(" "));
  if (!required) return true;
  if (!documentLabel) return false;
  if (documentLabel.includes(required) || required.includes(documentLabel)) return true;

  const aliases = [
    ["piece d'identite", ["cni", "carte identite", "carte d'identite", "identite", "passeport"]],
    ["contrat signe", ["contrat", "contrat de formation", "contrat travail"]],
    ["diplome ou cv", ["diplome", "cv", "curriculum"]],
    ["photo", ["photo", "portrait"]]
  ];
  return aliases.some(([canonical, words]) => (
    required.includes(canonical) && words.some(word => documentLabel.includes(word))
  ));
}

function personDocumentCompletion(person, kind) {
  const required = requiredDocumentsFor(kind);
  if (!required.length) return { missing: [], completed: true };
  const docs = Array.isArray(person?.documents) ? person.documents : [];
  const hasPhotoRequirement = required.some(label => normalizeSearchText(label).includes("photo"));
  const missing = required.filter(label => {
    const normalized = normalizeSearchText(label);
    if (normalized.includes("photo") && person?.photoData) return false;
    return !docs.some(documentItem => documentLabelMatchesRequirement(documentItem, label));
  });
  if (hasPhotoRequirement && !person?.photoData && !missing.some(label => normalizeSearchText(label).includes("photo"))) {
    missing.push("Photo");
  }
  return { missing, completed: missing.length === 0 };
}

function missingDocumentsText(completion) {
  const missing = completion?.missing || [];
  return missing.length ? `Manquant : ${missing.join(", ")}` : "Tous les documents obligatoires sont présents";
}

function documentCompletionBadge(person, kind) {
  const completion = personDocumentCompletion(person, kind);
  return completion.completed
    ? `<span class="status active">Dossier complet</span>`
    : `<span class="status inactive">Dossier incomplet</span><div class="missing-documents">${escapeHtml(missingDocumentsText(completion))}</div>`;
}

function renderPersonFileDraft(kind) {
  const draft = personFileDrafts[kind];
  const preview = ids[`${kind}PhotoPreview`];
  const list = ids[`${kind}DocumentList`];
  if (preview) {
    const src = normalizeLogoData(draft.photoData);
    preview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="">` : "Photo";
  }
  if (list) {
    list.innerHTML = draft.documents.map((documentItem, index) => `
      <article class="attached-document-item">
        <div>
          <strong>${escapeHtml(documentItem.type || documentItem.name || "Document")}</strong>
          <span>${escapeHtml(documentItem.originalName || documentItem.name || "Fichier")} · ${formatFileSize(documentItem.size)}</span>
        </div>
        <div class="row-actions">
          <a class="chip-button" href="${escapeHtml(documentItem.url || documentItem.data || "#")}" download="${escapeHtml(documentItem.name || "document")}" target="_blank" rel="noopener">Ouvrir</a>
          <button class="chip-button" type="button" data-action="rename-person-document" data-kind="${escapeHtml(kind)}" data-index="${index}">Renommer</button>
          <button class="chip-button danger" type="button" data-action="delete-person-document" data-kind="${escapeHtml(kind)}" data-index="${index}">Retirer</button>
        </div>
      </article>
    `).join("") || `<p class="muted">Aucun document ajouté.</p>`;
  }
}

async function importPersonPhoto(kind) {
  const input = document.getElementById(`${kind}PhotoInput`);
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Choisissez une image pour la photo");
    input.value = "";
    return;
  }
  try {
    const dataUrl = await imageToPngDataUrl(file, 420);
    personFileDrafts[kind].photoData = await uploadDataUrlToServer({
      dataUrl,
      name: file.name || `${kind}-photo.png`,
      folder: `${kind}/photos`
    });
    renderPersonFileDraft(kind);
  } catch {
    showToast("Photo illisible");
  } finally {
    input.value = "";
  }
}

function removePersonPhoto(kind) {
  personFileDrafts[kind].photoData = "";
  renderPersonFileDraft(kind);
}

async function uploadDataUrlToServer({ dataUrl, name, folder }) {
  if (!SERVER_MODE) return dataUrl;
  const result = await apiRequest("/api/upload", {
    method: "POST",
    body: JSON.stringify({ data: dataUrl, name, folder })
  });
  return result.url || dataUrl;
}

async function addPersonDocument(kind) {
  const fileInput = document.getElementById(`${kind}DocumentFile`);
  const typeInput = document.getElementById(`${kind}DocumentType`);
  const file = fileInput?.files?.[0];
  const documentLabel = typeInput?.value.trim() || "";
  if (!documentLabel) {
    showToast("Nommez le document avant de l'ajouter");
    typeInput?.focus();
    return;
  }
  if (!file) {
    showToast("Choisissez un fichier");
    return;
  }
  const maxSize = 4 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast("Fichier trop lourd : maximum 4 Mo");
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const storedUrl = await uploadDataUrlToServer({
      dataUrl,
      name: file.name,
      folder: `${kind}/documents`
    });
    personFileDrafts[kind].documents.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: documentLabel,
      name: file.name,
      originalName: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      ...(SERVER_MODE ? { url: storedUrl } : { data: storedUrl }),
      addedAt: new Date().toISOString(),
      addedBy: currentOperatorName()
    });
    if (typeInput) typeInput.value = "";
    if (fileInput) fileInput.value = "";
    renderPersonFileDraft(kind);
    showToast("Document ajouté au dossier");
  } catch {
    showToast("Ajout du fichier impossible");
  }
}

function deletePersonDocument(kind, index) {
  const draft = personFileDrafts[kind];
  if (!draft) return;
  draft.documents.splice(Number(index), 1);
  renderPersonFileDraft(kind);
}

function renamePersonDocument(kind, index) {
  const draft = personFileDrafts[kind];
  const documentItem = draft?.documents?.[Number(index)];
  if (!documentItem) return;
  const nextName = prompt("Nom du document", documentItem.type || documentItem.name || "");
  if (!nextName || !nextName.trim()) {
    showToast("Nom du document obligatoire");
    return;
  }
  documentItem.type = nextName.trim();
  renderPersonFileDraft(kind);
}

function formatDate(value) {
  if (!value) return "-";
  const text = String(value).trim();
  const date = text.includes("T") || text.includes(" ")
    ? new Date(text)
    : new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text || "-";
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function daysSince(value) {
  if (!value) return Infinity;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.floor((new Date(`${today()}T00:00:00`) - date) / DAY_MS);
}

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "-");
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function statusClass(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "-");
}

function documentTitleFromPrintArea() {
  const heading = ids.printArea?.querySelector(".receipt-type, h1, h2, .print-header h1");
  return heading?.textContent?.trim() || "Document";
}

function showPrintPreview(title = documentTitleFromPrintArea()) {
  if (!ids.printPreviewModal || !ids.printPreviewBody || !ids.printArea) {
    window.print();
    return;
  }
  ids.printPreviewTitle.textContent = title || "Document";
  ids.printPreviewBody.innerHTML = ids.printArea.innerHTML;
  ids.printPreviewModal.hidden = false;
  document.body.classList.add("print-preview-open");
}

function closePrintPreview() {
  if (!ids.printPreviewModal || !ids.printPreviewBody) return;
  ids.printPreviewModal.hidden = true;
  ids.printPreviewBody.innerHTML = "";
  document.body.classList.remove("print-preview-open");
}

function printPreviewDocument() {
  window.print();
}

function fullName(student) {
  if (!student) return "Étudiant supprimé";
  return `${String(student.lastName || "").toUpperCase()} ${student.firstName || ""}`.trim();
}

function findById(collection, id) {
  return collection.find(item => Number(item.id) === Number(id));
}

function getStudent(id) {
  return findById(state.students, id);
}

function getCourse(id) {
  return findById(state.courses, id);
}

function getGroup(id) {
  return findById(state.groups, id);
}

function getRoom(id) {
  return findById(state.rooms || [], id);
}

function getEnrollment(id) {
  return findById(state.enrollments, id);
}

function getCourseVersion(course, versionId) {
  if (!course) return null;
  return (course.versions || []).find(version => String(version.id) === String(versionId)) || null;
}

function activeCourseVersion(course) {
  if (!course) return null;
  const versions = Array.isArray(course.versions) ? course.versions : [];
  return versions.find(version => version.status === "active") || versions[0] || null;
}

function versionLabel(version) {
  if (!version) return "Version active";
  return [version.name || version.nomVersion || "Version", version.duration || "", version.year || ""]
    .filter(Boolean)
    .join(" - ");
}

function normalizePaymentSchedulePercentages(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[;,/\s]+/);
  const numbers = raw
    .map(item => Number(String(item).replace("%", "").trim()))
    .filter(item => Number.isFinite(item) && item > 0);
  const total = numbers.reduce((sum, item) => sum + item, 0);
  return total > 0 ? numbers : [100];
}

function paymentScheduleText(version) {
  return normalizePaymentSchedulePercentages(version?.paymentSchedulePercentages).map(value => `${value}%`).join(" / ");
}

function activeEnrollmentStatuses() {
  return ["en attente", "validee", "en cours", "suspendue"];
}

function terminalEnrollmentStatuses() {
  return ["annulee", "terminee", "abandon", "desiste"];
}

function normalizeEnrollmentStatus(value = "en attente") {
  const status = normalizeSearchText(value).trim();
  if (["validee", "valide", "validée"].includes(status)) return "validee";
  if (["en cours", "encours"].includes(status)) return "en cours";
  if (["suspendue", "suspendu"].includes(status)) return "suspendue";
  if (["annulee", "annule", "annulée"].includes(status)) return "annulee";
  if (["terminee", "termine", "terminée"].includes(status)) return "terminee";
  if (["abandon", "abandonnee", "abandonnée"].includes(status)) return "abandon";
  if (["desiste", "desistee", "désistée"].includes(status)) return "desiste";
  return "en attente";
}

function isActiveEnrollment(enrollment) {
  return activeEnrollmentStatuses().includes(normalizeEnrollmentStatus(enrollment?.status));
}

function isStudentConvertibleStatus(status) {
  return ["prospect", "preinscrit", "validation", ""].includes(String(status || "").toLowerCase());
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function enrollmentCourseType(enrollment) {
  const explicit = String(enrollment?.courseType || "").trim();
  if (explicit) return explicit;
  return getGroup(enrollment?.groupId)?.sessionType || "jour";
}

function getTrainer(id) {
  return findById(state.trainers, id);
}

function getStaffMember(id) {
  return findById(state.staffMembers, id);
}

function getEvaluation(id) {
  return findById(state.evaluations, id);
}

function groupSessionLabel(group) {
  const type = String(group?.sessionType || "jour");
  if (type === "soir") return "Cours du soir";
  if (type === "week-end") return "Week-end";
  if (type === "ligne") return "Cours en ligne";
  return "Cours du jour";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function trainerName(trainer) {
  if (!trainer) return "Formateur non precise";
  return `${String(trainer.lastName || "").toUpperCase()} ${trainer.firstName || ""}`.trim();
}

function staffName(member) {
  if (!member) return "Personnel supprimé";
  return `${String(member.lastName || "").toUpperCase()} ${member.firstName || ""}`.trim();
}

function payrollBeneficiaryValue(type, id) {
  return `${type}:${id}`;
}

function parsePayrollBeneficiary(value) {
  const [type, id] = String(value || "").split(":");
  return {
    type: type === "trainer" ? "trainer" : "staff",
    id: Number(id || 0)
  };
}

function payrollBeneficiary(payment) {
  const type = payment.payeeType === "trainer" ? "trainer" : "staff";
  const id = Number(payment.payeeId || payment.staffId || 0);
  const person = type === "trainer" ? getTrainer(id) : getStaffMember(id);
  return {
    type,
    id,
    person,
    name: type === "trainer" ? trainerName(person) : staffName(person),
    role: type === "trainer" ? "Formateur" : (person?.role || "Personnel"),
    phone: person?.phone || "",
    email: person?.email || "",
    baseSalary: type === "trainer" ? Number(person?.salary || 0) : Number(person?.salary || 0)
  };
}

function courseCost(course) {
  if (!course) return 0;
  return Number(course.trainingFee || 0);
}

function feeCategoryLabel(category = "autre") {
  const labels = {
    inscription: "Inscription",
    scolarite: "Scolarité",
    documentation: "Documentation",
    equipement: "Équipement",
    tenue: "Tenue",
    examen: "Examen",
    rattrapage: "Rattrapage",
    certificat: "Certificat",
    autre: "Autre"
  };
  return labels[String(category || "autre")] || "Autre";
}

function slugFee(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "frais";
}

function defaultCourseFees(course) {
  if (!course) return [];
  const courseId = Number(course.id || 0);
  const rows = [];
  const registrationFee = Number(course.registrationFee || 0);
  const trainingFee = Number(course.trainingFee || 0);
  if (registrationFee > 0) {
    rows.push({
      id: `${courseId}-inscription`,
      courseId,
      label: "Frais d'inscription",
      category: "inscription",
      amount: registrationFee,
      required: true,
      once: true,
      includedInTuition: false,
      active: true,
      order: 1,
      observation: ""
    });
  }
  if (trainingFee > 0) {
    rows.push({
      id: `${courseId}-scolarite`,
      courseId,
      label: "Frais de scolarité",
      category: "scolarite",
      amount: trainingFee,
      required: true,
      once: false,
      includedInTuition: true,
      active: true,
      order: 2,
      observation: ""
    });
  }
  return rows;
}

function normalizeCourseFee(course, fee, index = 0) {
  const category = String(fee?.category || "autre");
  const label = String(fee?.label || fee?.name || feeCategoryLabel(category)).trim();
  return {
    id: String(fee?.id || `${course?.id || "course"}-${slugFee(label)}-${index + 1}`),
    courseId: Number(fee?.courseId || course?.id || 0),
    label,
    category,
    amount: Number(fee?.amount || 0),
    required: fee?.required !== false,
    once: fee?.once !== false,
    includedInTuition: !!fee?.includedInTuition,
    active: fee?.active !== false,
    order: Number(fee?.order || index + 1),
    observation: String(fee?.observation || "")
  };
}

function courseFees(course, { activeOnly = true, versionId = 0 } = {}) {
  if (!course) return [];
  const version = getCourseVersion(course, versionId) || activeCourseVersion(course);
  const defaults = defaultCourseFees(course);
  const saved = Array.isArray(version?.fees) && version.fees.length
    ? version.fees
    : (Array.isArray(course.fees) ? course.fees : []);
  const source = saved.length ? saved : defaults;
  return source
    .map((fee, index) => normalizeCourseFee(course, fee, index))
    .filter(fee => !activeOnly || fee.active)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || a.label.localeCompare(b.label));
}

function courseFeeKey(fee) {
  return `coursefee:${fee.id}`;
}

function courseFeeFromKey(key) {
  const id = String(key || "").replace(/^coursefee:/, "");
  if (!id || id === key) return null;
  for (const course of state.courses || []) {
    for (const version of (course.versions || [null])) {
      const fee = courseFees(course, { activeOnly: false, versionId: version?.id }).find(item => String(item.id) === id);
      if (fee) return { ...fee, course, version };
    }
  }
  return null;
}

function isTuitionFee(fee) {
  return String(fee?.category || "") === "scolarite" || fee?.includedInTuition;
}

function activeFeesForEnrollment(enrollment) {
  if (Array.isArray(enrollment?.copiedFees) && enrollment.copiedFees.length) {
    return normalizeEnrollmentCopiedFees(enrollment);
  }
  return courseFees(getCourse(enrollment?.courseId), { versionId: enrollment?.versionId || enrollment?.formationVersionId });
}

function feePaidAmount(enrollmentId, fee, excludedPaymentId = 0) {
  const keys = [courseFeeKey(fee), enrollmentFeeKey(fee)];
  const legacyKeys = [
    String(fee?.category || ""),
    String(fee?.feeTypeId || ""),
    String(fee?.category || "") === "documentation" ? "document" : "",
    String(fee?.category || "") === "equipement" ? "equipement" : ""
  ].filter(Boolean);
  return paymentsForEnrollment(enrollmentId)
    .filter(payment => Number(payment.id) !== Number(excludedPaymentId))
    .filter(payment => {
      const paymentKey = String(payment.reasonKey || "");
      return keys.includes(paymentKey) ||
        legacyKeys.includes(paymentKey) ||
        (!paymentKey.includes("fee:") && normalizeSearchText(payment.reason) === normalizeSearchText(fee.label));
    })
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function feeBalance(enrollment, fee, excludedPaymentId = 0) {
  if (!fee || !enrollment) return 0;
  if (isTuitionFee(fee)) {
    return excludedPaymentId ? balanceForEnrollmentExcluding(enrollment, excludedPaymentId) : balanceForEnrollment(enrollment);
  }
  return Math.max(0, Number(fee.amountFinal ?? fee.amount ?? 0) - feePaidAmount(enrollment.id, fee, excludedPaymentId));
}

function feePaymentStatus(enrollment, fee, excludedPaymentId = 0) {
  const expected = Number(fee?.amountFinal ?? fee?.amount ?? 0);
  const paid = enrollment ? feePaidAmount(enrollment.id, fee, excludedPaymentId) : 0;
  const balance = enrollment ? feeBalance(enrollment, fee, excludedPaymentId) : expected;
  if (fee?.active === false) return "annulé";
  if (balance <= 0 && expected > 0) return "payé";
  if (paid > 0) return "partiel";
  return "non payé";
}

function paymentMotifForReason(reasonKey, enrollmentId = 0) {
  const enrollmentFee = enrollmentFeeFromKey(reasonKey, enrollmentId);
  if (enrollmentFee) {
    return {
      key: reasonKey,
      label: enrollmentFee.label,
      amount: Number(enrollmentFee.amountFinal ?? enrollmentFee.amount ?? 0),
      category: enrollmentFee.category,
      enrollmentFee
    };
  }
  return getPaymentMotif(reasonKey);
}

function courseFeeSummary(course, options = {}) {
  const fees = options.enrollment
    ? activeFeesForEnrollment(options.enrollment)
    : courseFees(course, options);
  const tuition = fees.filter(isTuitionFee).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0);
  const requiredAnnex = fees
    .filter(fee => !isTuitionFee(fee) && fee.required)
    .reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0);
  return {
    fees,
    tuition,
    requiredAnnex,
    grandTotal: tuition + requiredAnnex
  };
}

function syncCourseAmountsFromFees(course, fees) {
  const activeFees = (fees || []).filter(fee => fee.active !== false);
  const registration = activeFees.find(fee => fee.category === "inscription");
  const tuition = activeFees.find(isTuitionFee);
  course.registrationFee = Number(registration?.amount ?? course.registrationFee ?? 0);
  course.trainingFee = Number(tuition?.amount ?? course.trainingFee ?? 0);
}

function syncCourseBaseFees(course) {
  if (!course) return;
  const version = activeCourseVersion(course);
  if (Array.isArray(version?.fees) && version.fees.length) {
    version.fees = version.fees.map((fee, index) => normalizeCourseFee(course, fee, index));
    course.fees = version.fees;
    syncCourseAmountsFromFees(course, version.fees);
    return;
  }
  const fees = Array.isArray(course.fees) && course.fees.length
    ? course.fees.map((fee, index) => normalizeCourseFee(course, fee, index))
    : defaultCourseFees(course);
  const upsert = (category, label, amount, patch = {}) => {
    const existing = fees.find(fee => fee.category === category);
    if (amount <= 0 && !existing) return;
    const fee = existing || {
      id: `${course.id}-${category}`,
      courseId: Number(course.id || 0),
      label,
      category,
      order: category === "inscription" ? 1 : 2,
      observation: ""
    };
    if (!existing) Object.assign(fee, {
      label,
      category,
      amount: Number(amount || 0),
      required: true,
      once: category !== "scolarite",
      includedInTuition: category === "scolarite",
      active: Number(amount || 0) > 0,
      ...patch
    });
    if (!existing) fees.push(fee);
  };
  upsert("inscription", "Frais d'inscription", Number(course.registrationFee || 0));
  upsert("scolarite", "Frais de scolarité", Number(course.trainingFee || 0), { once: false, includedInTuition: true });
  course.fees = fees.map((fee, index) => normalizeCourseFee(course, fee, index));
  if (version) {
    version.fees = Array.isArray(version.fees) && version.fees.length ? version.fees : course.fees;
    version.duration = version.duration || course.duration || "";
    version.updatedAt = new Date().toISOString();
  }
  syncCourseAmountsFromFees(course, course.fees);
}

function ensureCourseVersions(course) {
  if (!course) return;
  if (!Array.isArray(course.versions) || !course.versions.length) {
    course.versions = [{
      id: `${course.id}-v1`,
      courseId: Number(course.id || 0),
      name: `Version ${new Date().getFullYear()}`,
      duration: course.duration || "",
      validFrom: "",
      validTo: "",
      year: String(new Date().getFullYear()),
      status: "active",
      observation: "",
      paymentSchedulePercentages: [100],
      fees: courseFees(course, { activeOnly: false }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
  }
  course.versions = course.versions.map((version, index) => ({
    id: String(version.id || `${course.id}-v${index + 1}`),
    courseId: Number(version.courseId || course.id || 0),
    name: version.name || version.nomVersion || `Version ${index + 1}`,
    duration: version.duration || course.duration || "",
    validFrom: version.validFrom || version.dateDebutValidite || "",
    validTo: version.validTo || version.dateFinValidite || "",
    year: version.year || version.period || String(new Date().getFullYear()),
    status: version.status || (index === 0 ? "active" : "ancienne"),
    observation: version.observation || "",
    paymentSchedulePercentages: normalizePaymentSchedulePercentages(version.paymentSchedulePercentages),
    fees: (Array.isArray(version.fees) && version.fees.length ? version.fees : courseFees(course, { activeOnly: false }))
      .map((fee, feeIndex) => normalizeCourseFee(course, { ...fee, formationVersionId: version.id }, feeIndex)),
    createdAt: version.createdAt || new Date().toISOString(),
    updatedAt: version.updatedAt || version.createdAt || new Date().toISOString()
  }));
}

function copiedFeeFromCourseFee(fee, enrollmentId = 0, discountAmount = 0) {
  const original = Number(fee.amountOriginal ?? fee.amount ?? 0);
  const hasExplicitFinal = fee.amountFinal !== undefined && fee.amountFinal !== null;
  const finalAmount = isTuitionFee(fee)
    ? (hasExplicitFinal && Number(discountAmount || 0) === 0
        ? Number(fee.amountFinal)
        : Math.max(0, original - Number(discountAmount || 0)))
    : Number(fee.amountFinal ?? fee.amount ?? original);
  const copiedId = String(fee.enrollmentFeeId || `${enrollmentId || "new"}-${fee.sourceFeeId || fee.id || slugFee(fee.label)}`);
  return {
    id: copiedId,
    enrollmentFeeId: copiedId,
    feeTypeId: fee.feeTypeId || fee.category || "",
    sourceFeeId: fee.id || "",
    label: fee.label || fee.libelle || "Frais",
    libelle: fee.label || fee.libelle || "Frais",
    category: fee.category || "autre",
    categorie: fee.category || "autre",
    amount: finalAmount,
    amountOriginal: original,
    amountFinal: finalAmount,
    montantOriginal: original,
    montantFinal: finalAmount,
    required: fee.required !== false,
    obligatoire: fee.required !== false,
    once: fee.once !== false,
    payableUneSeuleFois: fee.once !== false,
    includedInTuition: !!fee.includedInTuition,
    inclusDansScolarite: !!fee.includedInTuition,
    active: fee.active !== false,
    actif: fee.active !== false,
    order: Number(fee.order || 1),
    ordreAffichage: Number(fee.order || 1),
    observation: fee.observation || "",
    status: "non payé"
  };
}

function buildEnrollmentCopiedFees({ enrollmentId = 0, course, version, discountAmount = 0 }) {
  return courseFees(course, { versionId: version?.id })
    .filter(fee => fee.active)
    .map((fee, index) => ({
      ...copiedFeeFromCourseFee(fee, enrollmentId, isTuitionFee(fee) ? discountAmount : 0),
      order: Number(fee.order || index + 1)
    }));
}

function buildLegacyEnrollmentCopiedFees(enrollment) {
  if (!enrollment) return [];
  const fees = [];
  const registrationFee = Number(enrollment.registrationFee || 0);
  if (registrationFee > 0) {
    fees.push(copiedFeeFromCourseFee({
      id: `legacy-${enrollment.id}-inscription`,
      label: "Frais d'inscription",
      category: "inscription",
      amount: registrationFee,
      required: true,
      once: true,
      includedInTuition: false,
      active: true,
      order: 1,
      observation: "Migration depuis les anciens champs de l'inscription"
    }, enrollment.id, 0));
  }
  const tuitionOriginal = Number(enrollment.totalAmount ?? enrollment.finalAmount ?? 0);
  const tuitionFinal = Number(enrollment.finalAmount ?? Math.max(0, tuitionOriginal - Number(enrollment.discountAmount || 0)));
  if (tuitionOriginal > 0 || tuitionFinal > 0) {
    fees.push(copiedFeeFromCourseFee({
      id: `legacy-${enrollment.id}-scolarite`,
      label: "Frais de scolarité",
      category: "scolarite",
      amount: tuitionOriginal || tuitionFinal,
      amountOriginal: tuitionOriginal || tuitionFinal,
      amountFinal: tuitionFinal || tuitionOriginal,
      required: true,
      once: false,
      includedInTuition: true,
      active: true,
      order: 2,
      observation: "Migration depuis les anciens champs de l'inscription"
    }, enrollment.id, 0));
  }
  return fees;
}

function normalizeEnrollmentCopiedFees(enrollment) {
  if (!enrollment) return [];
  if ((!Array.isArray(enrollment.copiedFees) || !enrollment.copiedFees.length) && Array.isArray(enrollment.enrollmentFees) && enrollment.enrollmentFees.length) {
    enrollment.copiedFees = enrollment.enrollmentFees;
  }
  if (!Array.isArray(enrollment.copiedFees) || !enrollment.copiedFees.length) {
    enrollment.copiedFees = buildLegacyEnrollmentCopiedFees(enrollment);
  }
  enrollment.copiedFees = enrollment.copiedFees.map((fee, index) => ({
    ...copiedFeeFromCourseFee({
      ...fee,
      label: fee.label || fee.libelle,
      category: fee.category || fee.categorie,
      amount: fee.amount ?? fee.montantFinal ?? fee.montantOriginal,
      amountOriginal: fee.amountOriginal ?? fee.montantOriginal,
      amountFinal: fee.amountFinal ?? fee.montantFinal,
      required: fee.required ?? fee.obligatoire,
      once: fee.once ?? fee.payableUneSeuleFois,
      includedInTuition: fee.includedInTuition ?? fee.inclusDansScolarite,
      active: fee.active ?? fee.actif,
      order: fee.order ?? fee.ordreAffichage
    }, enrollment.id, 0),
    id: String(fee.id || fee.enrollmentFeeId || `${enrollment.id}-${index + 1}`),
    enrollmentFeeId: String(fee.enrollmentFeeId || fee.id || `${enrollment.id}-${index + 1}`),
    status: fee.status || "non payé"
  }));
  enrollment.copiedFees = alignCopiedTuitionWithEnrollment(enrollment, enrollment.copiedFees);
  enrollment.copiedFees = updateCopiedFeesDiscount(enrollment.copiedFees, enrollment.discountAmount || 0);
  enrollment.enrollmentFees = enrollment.copiedFees;
  return enrollment.copiedFees;
}

function copiedFeeOriginalAmount(fee) {
  return Number(fee?.amountOriginal ?? fee?.amount ?? fee?.amountFinal ?? 0);
}

function alignCopiedTuitionWithEnrollment(enrollment, copiedFees) {
  const expectedTotal = Number(enrollment?.totalAmount ?? 0);
  if (!Array.isArray(copiedFees) || !copiedFees.length || expectedTotal <= 0) return copiedFees || [];
  const tuitionIndexes = copiedFees
    .map((fee, index) => isTuitionFee(fee) ? index : -1)
    .filter(index => index >= 0);
  if (!tuitionIndexes.length) return copiedFees;

  const currentOriginalTotal = tuitionIndexes
    .reduce((sum, index) => sum + copiedFeeOriginalAmount(copiedFees[index]), 0);
  if (Math.abs(currentOriginalTotal - expectedTotal) < 1) return copiedFees;

  if (tuitionIndexes.length === 1) {
    const tuitionIndex = tuitionIndexes[0];
    return copiedFees.map((fee, index) => index === tuitionIndex
      ? { ...fee, amount: expectedTotal, amountOriginal: expectedTotal, montantOriginal: expectedTotal }
      : fee);
  }

  let allocated = 0;
  const divisor = currentOriginalTotal > 0 ? currentOriginalTotal : tuitionIndexes.length;
  return copiedFees.map((fee, index) => {
    if (!tuitionIndexes.includes(index)) return fee;
    const isLastTuition = index === tuitionIndexes[tuitionIndexes.length - 1];
    const base = currentOriginalTotal > 0 ? copiedFeeOriginalAmount(fee) : 1;
    const nextOriginal = isLastTuition
      ? Math.max(0, expectedTotal - allocated)
      : Math.round((base / divisor) * expectedTotal);
    allocated += nextOriginal;
    return { ...fee, amount: nextOriginal, amountOriginal: nextOriginal, montantOriginal: nextOriginal };
  });
}

function updateCopiedFeesDiscount(copiedFees, discountAmount = 0) {
  let remainingDiscount = Number(discountAmount || 0);
  return (copiedFees || []).map(fee => {
    const original = Number(fee.amountOriginal ?? fee.amount ?? 0);
    if (!isTuitionFee(fee)) {
      return {
        ...fee,
        amount: original,
        amountOriginal: original,
        amountFinal: Number(fee.amountFinal ?? fee.amount ?? 0),
        montantOriginal: original,
        montantFinal: Number(fee.amountFinal ?? fee.amount ?? 0)
      };
    }
    const discount = Math.min(original, Math.max(0, remainingDiscount));
    remainingDiscount -= discount;
    return {
      ...fee,
      amount: original,
      amountOriginal: original,
      amountFinal: Math.max(0, original - discount),
      montantOriginal: original,
      montantFinal: Math.max(0, original - discount)
    };
  });
}

function enrollmentFeeKey(fee) {
  return `enrollmentfee:${fee.enrollmentFeeId || fee.id}`;
}

function enrollmentFeeFromKey(key, enrollmentId = 0) {
  const id = String(key || "").replace(/^enrollmentfee:/, "");
  if (!id || id === key) return null;
  const enrollments = enrollmentId ? [getEnrollment(enrollmentId)].filter(Boolean) : state.enrollments;
  for (const enrollment of enrollments) {
    const fee = normalizeEnrollmentCopiedFees(enrollment).find(item => String(item.enrollmentFeeId || item.id) === id);
    if (fee) return { ...fee, enrollment };
  }
  return null;
}

function paymentsForEnrollment(enrollmentId) {
  return state.payments.filter(payment => Number(payment.enrollmentId) === Number(enrollmentId));
}

function isTuitionMotifKey(key) {
  const enrollmentFee = enrollmentFeeFromKey(key);
  if (enrollmentFee) return isTuitionFee(enrollmentFee);
  const courseFee = courseFeeFromKey(key);
  if (courseFee) return isTuitionFee(courseFee);
  return TUITION_MOTIF_KEYS.includes(String(key || "").toLowerCase());
}

function isMakeupMotifKey(key) {
  return String(key || "").toLowerCase() === MAKEUP_MOTIF_KEY;
}

function isTuitionPayment(payment) {
  const key = String(payment.reasonKey || "").toLowerCase();
  if (isTuitionMotifKey(key)) return true;
  const reason = normalizeSearchText(payment.reason);
  return ["scolarite", "frais de scolarite", "formation", "frais formation", "frais de formation", "mensualite"]
    .some(label => reason === label);
}

function tuitionPaymentsForEnrollment(enrollmentId) {
  return paymentsForEnrollment(enrollmentId).filter(isTuitionPayment);
}

function annexPaymentsForEnrollment(enrollmentId) {
  return paymentsForEnrollment(enrollmentId).filter(payment => !isTuitionPayment(payment));
}

function lastPaymentDateForEnrollment(enrollmentId, predicate = () => true) {
  return paymentsForEnrollment(enrollmentId)
    .filter(predicate)
    .map(payment => payment.date)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function paidAmount(enrollmentId) {
  return tuitionPaymentsForEnrollment(enrollmentId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function paidAmountExcluding(enrollmentId, excludedPaymentId) {
  return tuitionPaymentsForEnrollment(enrollmentId)
    .filter(payment => Number(payment.id) !== Number(excludedPaymentId))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function annexPaidAmount(enrollmentId) {
  return annexPaymentsForEnrollment(enrollmentId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function totalPaidAmountForEnrollment(enrollmentId) {
  return paymentsForEnrollment(enrollmentId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function isDesistedEnrollment(enrollment) {
  if (!enrollment) return false;
  const student = getStudent(enrollment.studentId);
  return normalizeEnrollmentStatus(enrollment.status) === "desiste" ||
    String(student?.status || "").toLowerCase() === "desiste";
}

function isInactiveTuitionEnrollment(enrollment) {
  return ["annulee", "desiste"].includes(normalizeEnrollmentStatus(enrollment?.status)) || isDesistedEnrollment(enrollment);
}

function isAbandonedEnrollment(enrollment) {
  if (!enrollment) return false;
  const student = getStudent(enrollment.studentId);
  return normalizeEnrollmentStatus(enrollment.status) === "abandon" ||
    String(student?.status || "").toLowerCase() === "abandon";
}

function suppressPaymentTrackingForEnrollment(enrollment) {
  return ["annulee", "terminee", "desiste"].includes(normalizeEnrollmentStatus(enrollment?.status)) ||
    isDesistedEnrollment(enrollment) ||
    isAbandonedEnrollment(enrollment);
}

function tuitionExpectedForEnrollment(enrollment) {
  if (suppressPaymentTrackingForEnrollment(enrollment)) return 0;
  const copiedTuition = normalizeEnrollmentCopiedFees(enrollment)
    .filter(isTuitionFee)
    .reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0);
  return Array.isArray(enrollment?.copiedFees) && enrollment.copiedFees.some(isTuitionFee)
    ? copiedTuition
    : Number(enrollment?.finalAmount ?? 0);
}

function balanceForEnrollment(enrollment) {
  if (!enrollment) return 0;
  return Math.max(0, tuitionExpectedForEnrollment(enrollment) - paidAmount(enrollment.id));
}

function balanceForEnrollmentExcluding(enrollment, excludedPaymentId) {
  if (!enrollment) return 0;
  return Math.max(0, tuitionExpectedForEnrollment(enrollment) - paidAmountExcluding(enrollment.id, excludedPaymentId));
}

function paymentsTotal() {
  return state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function tuitionPaymentsTotal() {
  return state.payments.filter(isTuitionPayment).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function annexPaymentsTotal() {
  return state.payments.filter(payment => !isTuitionPayment(payment)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function tuitionPaymentsTotalForYear(year = currentAcademicYear()) {
  return paymentsForAcademicYear(year).filter(isTuitionPayment).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function annexPaymentsTotalForYear(year = currentAcademicYear()) {
  return paymentsForAcademicYear(year).filter(payment => !isTuitionPayment(payment)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function expensesTotalForYear(year = currentAcademicYear()) {
  const cashExpenses = cashEntriesForAcademicYear(year)
    .filter(entry => entry.type === "expense")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return cashExpenses + staffPaymentsForAcademicYear(year).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function incomeTotalForYear(year = currentAcademicYear()) {
  return paymentsForAcademicYear(year).reduce((sum, payment) => sum + Number(payment.amount || 0), 0) +
    cashEntriesForAcademicYear(year)
      .filter(entry => entry.type === "income")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function balanceDueForYear(year = currentAcademicYear()) {
  return enrollmentsForAcademicYear(year).reduce((sum, enrollment) => sum + balanceForEnrollment(enrollment), 0);
}

function paymentFeeCategory(payment) {
  const enrollmentFee = enrollmentFeeFromKey(payment?.reasonKey, payment?.enrollmentId);
  if (enrollmentFee) return enrollmentFee.category || "autre";
  const courseFee = courseFeeFromKey(payment?.reasonKey);
  if (courseFee) return courseFee.category || "autre";
  if (isTuitionPayment(payment)) return "scolarite";
  if (String(payment?.reasonKey || "") === "inscription") return "inscription";
  if (isMakeupMotifKey(payment?.reasonKey)) return "rattrapage";
  return "autre";
}

function paymentsTotalByFeeCategory() {
  return state.payments.reduce((map, payment) => {
    const category = paymentFeeCategory(payment);
    map[category] = (map[category] || 0) + Number(payment.amount || 0);
    return map;
  }, {});
}

function cashIncomeTotal() {
  return state.cashEntries
    .filter(entry => entry.type === "income")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function cashExpenseTotal() {
  const cashExpenses = state.cashEntries
    .filter(entry => entry.type === "expense")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return cashExpenses + staffPaymentsTotal();
}

function staffPaymentsTotal() {
  return state.staffPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function netCashTotal() {
  return paymentsTotal() + cashIncomeTotal() - cashExpenseTotal();
}

function cashLedgerEntries() {
  const studentPaymentEntries = state.payments.map(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : null;
    return {
      id: `payment-${payment.id}`,
      source: "payment",
      date: payment.date,
      type: "income",
      category: isTuitionPayment(payment) ? "Paiement scolarité" : "Paiement frais annexes",
      amount: Number(payment.amount || 0),
      method: payment.method || "-",
      description: `${payment.receiptNumber || "-"} - ${fullName(student)} - ${payment.reason || "Paiement étudiant"}`,
      recordedBy: payment.receivedBy || payment.recordedBy || "",
      locked: true
    };
  });

  const manualEntries = state.cashEntries.map(entry => ({
    id: `cash-${entry.id}`,
    source: "cash",
    rawId: entry.id,
    date: entry.date,
    type: entry.type === "expense" ? "expense" : "income",
    category: entry.category || "-",
    amount: Number(entry.amount || 0),
    method: entry.method || "-",
    description: entry.description || "",
    recordedBy: entry.recordedBy || "",
    closedAt: entry.closedAt || "",
    closedBy: entry.closedBy || "",
    locked: !!entry.closedAt
  }));

  const payrollEntries = state.staffPayments.map(payment => {
    const beneficiary = payrollBeneficiary(payment);
    return {
      id: `payroll-${payment.id}`,
      source: "payroll",
      date: payment.date,
      type: "expense",
      category: payment.reason || "Paiement personnel",
      amount: Number(payment.amount || 0),
      method: payment.method || "-",
      description: `${beneficiary.name} - ${beneficiary.role}${payment.period ? ` - ${payment.period}` : ""}${payment.note ? ` - ${payment.note}` : ""}`,
      recordedBy: payment.recordedBy || "",
      locked: true
    };
  });

  return [...studentPaymentEntries, ...manualEntries, ...payrollEntries]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id)));
}

function studentsForGroup(groupId) {
  const seen = new Set();
  return state.enrollments
    .filter(enrollment => Number(enrollment.groupId) === Number(groupId) && !isInactiveTuitionEnrollment(enrollment))
    .map(enrollment => getStudent(enrollment.studentId))
    .filter(student => {
      if (!student || seen.has(Number(student.id))) return false;
      seen.add(Number(student.id));
      return true;
    });
}

function formatAverage(evaluation) {
  const grades = Array.isArray(evaluation.grades) ? evaluation.grades : [];
  const scored = grades
    .map(grade => effectiveGradeScore(grade))
    .filter(score => score !== null);
  if (!scored.length) return "-";
  const total = scored.reduce((sum, score) => sum + Number(score || 0), 0);
  const average = total / scored.length;
  return `${average.toFixed(2)} / ${Number(evaluation.maxScore || 20)}`;
}

function passingScoreFor(maxScore = 20) {
  return Number(maxScore || 20) * PASSING_SCORE_20 / 20;
}

function validScoreValue(score) {
  if (score === "" || score === null || score === undefined || Number.isNaN(Number(score))) return false;
  return true;
}

function effectiveGradeScore(grade) {
  if (validScoreValue(grade?.makeupScore)) return Number(grade.makeupScore);
  if (validScoreValue(grade?.score)) return Number(grade.score);
  return null;
}

function gradeNeedsMakeup(score, maxScore = 20, makeupScore = "") {
  if (!validScoreValue(score)) return false;
  if (Number(score) >= passingScoreFor(maxScore)) return false;
  if (validScoreValue(makeupScore)) {
    return Number(makeupScore) < passingScoreFor(maxScore);
  }
  return true;
}

function gradeStatusLabel(score, maxScore = 20, makeupScore = "") {
  if (!validScoreValue(score)) return "Non noté";
  if (Number(score) >= passingScoreFor(maxScore)) return "Validé";
  if (validScoreValue(makeupScore)) {
    return Number(makeupScore) >= passingScoreFor(maxScore)
      ? "Validé après rattrapage"
      : "Rattrapage non validé";
  }
  return "Rattrapage requis";
}

function evaluationMakeupStats(evaluation) {
  const maxScore = Number(evaluation?.maxScore || 20);
  const count = (evaluation?.grades || []).filter(grade => gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore)).length;
  return {
    count,
    amount: count * MAKEUP_FEE
  };
}

function centerContactLine() {
  const center = state.center || {};
  return [center.address, center.phone, center.email].filter(Boolean).join(" - ");
}

function printHeaderHtml(title) {
  const center = state.center || {};
  const logoSrc = normalizeLogoData(center.logoData);
  const stampSrc = normalizeLogoData(center.stampData);
  return `
    <div class="print-header">
      ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="Logo ${escapeHtml(center.name || "CFP EREXIT")}">` : ""}
      <div>
        <h1>${escapeHtml(center.name || "CFP EREXIT")}</h1>
        <p>${escapeHtml(center.subtitle || "Centre de Formation Professionnelle")}</p>
        <p>${escapeHtml(centerContactLine())}</p>
      </div>
    </div>
    <hr>
    <h2>${escapeHtml(title)}</h2>
  `;
}

function normalizeLogoData(value) {
  const logo = String(value || "").trim();
  if (logo.startsWith("/") || logo.startsWith("http://") || logo.startsWith("https://") || logo.startsWith("blob:")) {
    return logo;
  }
  const match = logo.match(/^(data:image\/[a-zA-Z0-9.+-]+;base64,)(.+)$/);
  if (!match) return logo.startsWith("data:image/svg+xml") ? logo : "";

  let payload = match[2].replace(/\s+/g, "").replace(/=+$/g, "");
  while (payload.length % 4 === 1) {
    payload = payload.slice(0, -1);
  }
  const padding = ["", "", "==", "="][payload.length % 4];
  payload += padding;
  return `${match[1]}${payload}`;
}

function imageToPngDataUrl(file, maxSize = 512) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    image.src = url;
  });
}

function svgToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (!text.includes("<svg")) {
        reject(new Error("SVG invalide"));
        return;
      }
      resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
    };
    reader.onerror = () => reject(new Error("Lecture impossible"));
    reader.readAsText(file);
  });
}

function showToast(message) {
  ids.toast.textContent = message;
  ids.toast.classList.add("show");
  window.setTimeout(() => ids.toast.classList.remove("show"), 2200);
}

function repairDisplayText(value) {
  const replacements = [
    ["ÃƒÂ©", "é"], ["ÃƒÂ¨", "è"], ["ÃƒÂª", "ê"], ["ÃƒÂ«", "ë"],
    ["ÃƒÂ ", "à"], ["ÃƒÂ¢", "â"], ["ÃƒÂ´", "ô"], ["ÃƒÂ¹", "ù"],
    ["ÃƒÂ»", "û"], ["ÃƒÂ§", "ç"], ["Ãƒâ€°", "É"], ["Ãƒâ‚¬", "À"],
    ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"], ["Ã«", "ë"],
    ["Ã ", "à"], ["Ã¢", "â"], ["Ã´", "ô"], ["Ã¹", "ù"],
    ["Ã»", "û"], ["Ã§", "ç"], ["Ã‰", "É"], ["Ã€", "À"],
    ["Â·", "·"], ["Â°", "°"], ["â€™", "'"], ["â€˜", "'"],
    ["â€œ", "\""], ["â€", "\""], ["â€“", "-"], ["â€”", "-"],
    ["ï¿½", "é"], ["�", "é"]
  ];
  return replacements.reduce((text, [from, to]) => text.split(from).join(to), String(value ?? ""));
}

function escapeHtml(value) {
  return repairDisplayText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setView(view) {
  if (!canAccessView(view)) {
    showToast("Accès non autorisé");
    view = firstAllowedView();
  }
  currentView = view;
  applyViewState();
  render();
}

function applyViewState() {
  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.dataset.view === currentView);
  });
  document.querySelectorAll("[data-view-target]").forEach(button => {
    const target = button.dataset.viewTarget;
    const allowed = canAccessView(target);
    button.hidden = !allowed;
    button.disabled = !allowed;
    button.classList.toggle("active", target === currentView);
  });
  ids.pageTitle.textContent = repairDisplayText(VIEW_LABELS[currentView] || "Tableau de bord");
}

function render() {
  ensureCollections();
  ensurePaymentMotifs();
  if (!canAccessView(currentView)) {
    currentView = firstAllowedView();
  }
  applyViewState();
  const viewRenderers = {
    dashboard: ["tableau de bord", renderDashboard],
    onlineRequests: ["demandes en ligne", renderOnlineRequests],
    students: ["étudiants", renderStudents],
    courses: ["formations", renderCourses],
    groups: ["promotions", renderGroups],
    enrollments: ["inscriptions", renderEnrollments],
    payments: ["paiements", renderPayments],
    cash: ["caisse", renderCash],
    notifications: ["notifications", renderNotifications],
    planning: ["planning", renderPlanning],
    announcements: ["annonces", renderAnnouncements],
    resources: ["salles et matériels", renderResources],
    attendance: ["présences", () => {
      renderAttendance();
      renderTrainerAttendance();
    }],
    trainers: ["formateurs", renderTrainers],
    staff: ["personnel", renderStaff],
    reports: ["rapports", renderReports],
    grades: ["notes", renderEvaluations],
    settings: ["paramètres", renderSettings]
  };
  [
    ["identité", renderCenterIdentity],
    ["session", renderSession],
    ["badge notifications", renderNotificationBadge],
    ["sélecteurs", syncSelects],
    viewRenderers[currentView] || ["tableau de bord", renderDashboard]
  ].forEach(([label, step]) => {
    try {
      step();
    } catch (error) {
      console.error(`Erreur rendu ${label} :`, error);
    }
  });
  applyTablePagination();
}

function renderSession() {
  const roleSelect = document.getElementById("roleSelect");
  const logoutButton = document.getElementById("logoutButton");

  if (!SERVER_MODE) {
    ids.currentUserName.textContent = "Mode local";
    logoutButton.hidden = true;
    roleSelect.disabled = false;
    return;
  }

  ids.currentUserName.textContent = currentUser
    ? `${currentUser.name} - ${currentUser.role}`
    : "Non connecté";
  logoutButton.hidden = !currentUser;
  roleSelect.disabled = true;
  if (currentUser?.role) {
    roleSelect.value = currentUser.role;
  }
}

function applyTablePagination() {
  document.querySelectorAll(".table-pagination").forEach(control => control.remove());
  document.querySelectorAll(".view tbody[id] tr").forEach(row => {
    row.hidden = false;
  });
}

function renderAndPaginate(step, tableIds = []) {
  tableIds.forEach(tableId => {
    tablePages[tableId] = 1;
  });
  step();
  applyTablePagination();
}

function refreshDashboardAfterDataChange() {
  try {
    renderDashboard();
    renderNotificationBadge();
    renderCash();
    renderReports();
    applyTablePagination();
  } catch (error) {
    console.error("Erreur actualisation tableau de bord :", error);
  }
}

function paginateTableBody(tbody) {
  const rows = [...tbody.children].filter(row => row.tagName === "TR");
  const tableId = tbody.id;
  const tableWrap = tbody.closest(".table-wrap");
  if (!tableId || !tableWrap) return;

  let controls = tableWrap.nextElementSibling;
  if (!controls || controls.dataset.paginationFor !== tableId) {
    controls = document.createElement("div");
    controls.className = "table-pagination";
    controls.dataset.paginationFor = tableId;
    tableWrap.insertAdjacentElement("afterend", controls);
  }

  if (rows.length <= TABLE_PAGE_SIZE || rows.some(row => row.querySelector("td[colspan]"))) {
    rows.forEach(row => { row.hidden = false; });
    controls.hidden = true;
    controls.innerHTML = "";
    tablePages[tableId] = 1;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const page = Math.min(Math.max(1, tablePages[tableId] || 1), totalPages);
  tablePages[tableId] = page;
  const start = (page - 1) * TABLE_PAGE_SIZE;
  const end = start + TABLE_PAGE_SIZE;

  rows.forEach((row, index) => {
    row.hidden = index < start || index >= end;
  });

  controls.hidden = false;
  controls.innerHTML = `
    <span>${start + 1}-${Math.min(end, rows.length)} sur ${rows.length}</span>
    <div>
      <button class="chip-button" type="button" data-table-page="${tableId}" data-page-direction="prev" ${page <= 1 ? "disabled" : ""}>Précédent</button>
      <strong>Page ${page} / ${totalPages}</strong>
      <button class="chip-button" type="button" data-table-page="${tableId}" data-page-direction="next" ${page >= totalPages ? "disabled" : ""}>Suivant</button>
    </div>
  `;
}

function handleTablePaginationClick(event) {
  const button = event.target.closest("[data-table-page]");
  if (!button) return;
  const tableId = button.dataset.tablePage;
  const direction = button.dataset.pageDirection;
  tablePages[tableId] = Math.max(1, (tablePages[tableId] || 1) + (direction === "next" ? 1 : -1));
  const tbody = document.getElementById(tableId);
  if (tbody) paginateTableBody(tbody);
}

function renderCenterIdentity() {
  const center = state.center || {};
  const name = center.name || "CFP EREXIT";
  const subtitle = center.subtitle || "Centre de Formation Professionnelle";
  const logoSrc = normalizeLogoData(center.logoData);
  if (logoSrc && logoSrc !== center.logoData) {
    state.center = { ...center, logoData: logoSrc };
    saveState();
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase() || "CE";

  document.querySelectorAll(".brand-mark, .choice-mark").forEach(mark => {
    const fallback = mark.classList.contains("choice-mark") ? mark.textContent.trim() || initials : initials;
    mark.innerHTML = logoSrc
      ? `<img src="${escapeHtml(logoSrc)}" alt="" aria-hidden="true">`
      : escapeHtml(fallback);
  });

  document.querySelectorAll(".brand h1").forEach(title => {
    title.textContent = repairDisplayText(name);
  });

  const sidebarSubtitle = document.querySelector(".sidebar .brand p");
  if (sidebarSubtitle) {
    sidebarSubtitle.textContent = repairDisplayText(subtitle);
  }

  if (ids.centerLogoPreview) {
    ids.centerLogoPreview.innerHTML = logoSrc
      ? `<img src="${escapeHtml(logoSrc)}" alt="" aria-hidden="true">`
      : escapeHtml(initials);
  }
  if (ids.centerStampPreview) {
    const stampSrc = normalizeLogoData(center.stampData);
    ids.centerStampPreview.innerHTML = stampSrc
      ? `<img src="${escapeHtml(stampSrc)}" alt="" aria-hidden="true">`
      : "Cachet";
  }
}

function renderDashboard() {
  const monthKey = today().slice(0, 7);
  const totalStudents = state.students.length;
  const onlineRequests = state.onlineRegistrationRequests || [];
  const newOnlineRequests = onlineRequests.filter(item => ["nouvelle", "verification", "complement", "dossier-incomplet", "paiement-attendu", "acceptee"].includes(String(item.status || "nouvelle"))).length;
  const pendingOnlinePayments = (state.onlinePayments || []).filter(item => String(item.status || "") === "en attente").length;
  const confirmedOnlinePayments = (state.onlinePayments || []).filter(item => String(item.status || "") === "reussi").length;
  const preRegisteredStudents = state.students.filter(student => student.status === "preinscrit").length;
  const abandonedStudents = state.students.filter(student => ["abandon", "desiste"].includes(String(student.status || "").toLowerCase())).length;
  const validatedEnrollments = state.enrollments.filter(enrollment => enrollment.status === "validee").length;
  const activeGroups = state.groups.filter(group => group.status === "active").length;
  const totalExpected = state.enrollments.reduce((sum, enrollment) => sum + tuitionExpectedForEnrollment(enrollment), 0);
  const monthPayments = state.payments
    .filter(payment => String(payment.date || "").slice(0, 7) === monthKey)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const todayExpenses = cashLedgerEntries()
    .filter(entry => entry.type === "expense" && entry.date === today())
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const monthExpenses = cashLedgerEntries()
    .filter(entry => entry.type === "expense" && String(entry.date || "").slice(0, 7) === monthKey)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const incompleteDocumentCount = state.students.filter(student => !personDocumentCompletion(student, "student").completed).length;
  const activeStudents = state.students.filter(student => student.status === "actif").length;
  const activeCourses = state.courses.filter(course => course.status === "active").length;
  const totalPaid = paymentsTotal();
  const tuitionPaid = tuitionPaymentsTotal();
  const annexPaid = annexPaymentsTotal();
  const totalExpenses = cashExpenseTotal();
  const totalDue = state.enrollments.reduce((sum, enrollment) => sum + balanceForEnrollment(enrollment), 0);
  const todayPayments = state.payments
    .filter(payment => payment.date === today())
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  ids.statsGrid.innerHTML = [
    { label: "Total etudiants", value: totalStudents, tone: "blue" },
    { label: "Demandes en ligne", value: newOnlineRequests, tone: "gold" },
    { label: "Paiements web attente", value: pendingOnlinePayments, tone: "orange" },
    { label: "Paiements web valides", value: confirmedOnlinePayments, tone: "green" },
    { label: "Preinscrits", value: preRegisteredStudents, tone: "gold" },
    { label: "Inscrits valides", value: validatedEnrollments, tone: "green" },
    { label: "Abandons / desist.", value: abandonedStudents, tone: "red" },
    { label: "Promotions actives", value: activeGroups, tone: "sky" },
    { label: "Scolarite attendue", value: totalExpected, type: "money", tone: "indigo" },
    { label: "Encaissement jour", value: todayPayments, type: "money", tone: "green" },
    { label: "Encaissement mois", value: monthPayments, type: "money", tone: "green" },
    { label: "Depenses jour", value: todayExpenses, type: "money", tone: "orange" },
    { label: "Depenses mois", value: monthExpenses, type: "money", tone: "orange" },
    { label: "Dossiers incomplets", value: incompleteDocumentCount, tone: "red" },
    { label: "Étudiants actifs", value: activeStudents, tone: "blue" },
    { label: "Formations actives", value: activeCourses, tone: "green" },
    { label: "Inscriptions", value: state.enrollments.length, tone: "gold" },
    { label: "Scolarité reçue", value: tuitionPaid, type: "money", tone: "green" },
    { label: "Frais annexes", value: annexPaid, type: "money", tone: "sky" },
    { label: "Paiements reçus", value: totalPaid, type: "money", tone: "indigo" },
    { label: "Dépenses", value: totalExpenses, type: "money", tone: "orange" },
    { label: "Solde caisse", value: netCashTotal(), type: "money", tone: "green" },
    { label: "Reste scolarité", value: totalDue, type: "money", tone: "red" }
  ].map(item => `
    <article class="stat-card tone-${item.tone}">
      <span>${escapeHtml(item.label)}</span>
      ${statValueHtml(item)}
    </article>
  `).join("");

  const recentPayments = [...state.payments]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5);

  ids.recentPaymentsTable.innerHTML = recentPayments.map(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : undefined;
    const controlInfo = payment.correctedAt
      ? `<div class="muted">Corrige le ${escapeHtml(formatDate(payment.correctedAt))}</div>`
      : "";
    return `
      <tr>
        <td>${escapeHtml(payment.receiptNumber)}${controlInfo}</td>
        <td>${escapeHtml(fullName(student))}</td>
        <td class="amount-positive">${formatMoney(payment.amount)}</td>
        <td>${formatDate(payment.date)}</td>
      </tr>
    `;
  }).join("") || emptyRow(4, "Aucun paiement");

  ids.balancesTable.innerHTML = balances()
    .slice(0, 6)
    .map(item => `
      <tr>
        <td>${escapeHtml(item.student)}</td>
        <td>
          <strong>${escapeHtml(item.course)}</strong>
          <div class="muted">${escapeHtml(item.sessionType)}</div>
        </td>
        <td class="amount-danger">${formatMoney(item.balance)}</td>
      </tr>
    `).join("") || emptyRow(3, "Aucun impayé");

  const alerts = paymentAlerts();
  const urgentAlerts = alerts.filter(alert => alert.severity === "danger").length;
  ids.paymentAlertCount.textContent = `${alerts.length} alerte(s)${urgentAlerts ? `, ${urgentAlerts} urgente(s)` : ""}`;
  ids.paymentAlertsTable.innerHTML = alerts.slice(0, 8).map(alert => `
    <tr>
      <td>
        <strong>${escapeHtml(alert.student)}</strong>
        <div class="muted">${escapeHtml(alert.detail)} - ${escapeHtml(alert.sessionType)}</div>
      </td>
      <td><span class="alert-pill ${alert.severity}">${escapeHtml(alert.message)}</span></td>
      <td class="${alert.severity === "danger" ? "amount-danger" : ""}">${formatMoney(alert.amount)}</td>
      <td>${alert.lastPaymentDate ? formatDate(alert.lastPaymentDate) : "Aucun"}</td>
      <td>
        <button class="chip-button success" type="button" data-action="pay-alert" data-id="${alert.enrollmentId}" data-reason="${escapeHtml(alert.reasonKey)}">Encaisser</button>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucune alerte");

  renderDashboardAnalytics({
    tuitionPaid,
    annexPaid,
    totalExpenses,
    totalDue
  });
  renderAdvancedDashboardStats();

  if (todayPayments > 0) {
    document.title = `CFP EREXIT - ${formatMoney(todayPayments)} aujourd'hui`;
  } else {
    document.title = "CFP EREXIT Manager";
  }
}

function renderAdvancedDashboardStats() {
  if (!ids.advancedStatsGrid || !ids.advancedStatsDetails) return;
  const year = currentAcademicYear();
  const archived = archivedAcademicYears();
  const enrollments = enrollmentsForAcademicYear(year);
  const activeEnrollments = enrollments.filter(enrollment => !isInactiveTuitionEnrollment(enrollment));
  const studentIds = studentIdsForAcademicYear(year);
  const tuitionExpected = activeEnrollments.reduce((sum, enrollment) => sum + tuitionExpectedForEnrollment(enrollment), 0);
  const tuitionPaid = tuitionPaymentsTotalForYear(year);
  const annexPaid = annexPaymentsTotalForYear(year);
  const expenses = expensesTotalForYear(year);
  const balanceDue = balanceDueForYear(year);
  const recoveryRate = tuitionExpected > 0 ? Math.round((tuitionPaid / tuitionExpected) * 100) : 0;
  const abandoned = enrollments.filter(enrollment => ["abandon", "desiste"].includes(normalizeEnrollmentStatus(enrollment.status))).length;
  const abandonmentRate = enrollments.length ? Math.round((abandoned / enrollments.length) * 100) : 0;
  const incompleteDocs = [...studentIds]
    .map(id => getStudent(id))
    .filter(student => student && !personDocumentCompletion(student, "student").completed)
    .length;
  const validGrades = state.evaluations
    .filter(evaluation => enrollments.some(enrollment => Number(enrollment.groupId) === Number(evaluation.groupId)))
    .flatMap(evaluation => (evaluation.grades || []).map(grade => ({
      grade,
      evaluation
    })))
    .filter(item => studentIds.has(Number(item.grade.studentId)));
  const passedGrades = validGrades.filter(item => !gradeNeedsMakeup(item.grade.score, item.evaluation.maxScore || 20, item.grade.makeupScore)).length;
  const successRate = validGrades.length ? Math.round((passedGrades / validGrades.length) * 100) : 0;

  if (ids.activeYearLabel) {
    ids.activeYearLabel.textContent = archived.length
      ? `Année active ${year} · Archives ${archived.join(", ")}`
      : `Année active ${year}`;
  }

  ids.advancedStatsGrid.innerHTML = [
    { label: "Étudiants année", value: studentIds.size, tone: "blue" },
    { label: "Inscriptions actives", value: activeEnrollments.length, tone: "green" },
    { label: "Recouvrement", value: `${Math.max(0, recoveryRate)}%`, type: "text", tone: "green" },
    { label: "Taux abandon", value: `${Math.max(0, abandonmentRate)}%`, type: "text", tone: "red" },
    { label: "Réussite notes", value: `${Math.max(0, successRate)}%`, type: "text", tone: "indigo" },
    { label: "Docs incomplets", value: incompleteDocs, tone: incompleteDocs ? "orange" : "green" },
    { label: "Scolarité encaissée", value: tuitionPaid, type: "money", tone: "green" },
    { label: "Reste prévisionnel", value: balanceDue, type: "money", tone: "red" },
    { label: "Annexes encaissées", value: annexPaid, type: "money", tone: "sky" },
    { label: "Dépenses année", value: expenses, type: "money", tone: "orange" }
  ].map(item => `
    <article class="advanced-stat-card tone-${item.tone}">
      <span>${escapeHtml(item.label)}</span>
      ${statValueHtml(item)}
    </article>
  `).join("");

  const courseStats = state.courses.map(course => {
    const courseEnrollments = activeEnrollments.filter(enrollment => Number(enrollment.courseId) === Number(course.id));
    const coursePayments = paymentsForAcademicYear(year).filter(payment => {
      const enrollment = getEnrollment(payment.enrollmentId);
      return enrollment && Number(enrollment.courseId) === Number(course.id);
    });
    return {
      label: course.code || course.name || "-",
      name: course.name || course.code || "-",
      enrollments: courseEnrollments.length,
      revenue: coursePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    };
  }).filter(item => item.enrollments > 0 || item.revenue > 0);
  const topByDemand = [...courseStats].sort((a, b) => b.enrollments - a.enrollments).slice(0, 5);
  const topByRevenue = [...courseStats].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const maxDemand = Math.max(1, ...topByDemand.map(item => item.enrollments));
  const maxRevenue = Math.max(1, ...topByRevenue.map(item => item.revenue));

  ids.advancedStatsDetails.innerHTML = `
    <div class="advanced-list-card">
      <h4>Top formations demandées</h4>
      ${topByDemand.map(item => `
        <div class="advanced-row">
          <span>${escapeHtml(item.label)}</span>
          <div class="analytics-track"><div class="analytics-fill course" style="width: ${(item.enrollments / maxDemand) * 100}%"></div></div>
          <strong>${item.enrollments}</strong>
        </div>
      `).join("") || `<p class="muted">Aucune inscription sur l'année active.</p>`}
    </div>
    <div class="advanced-list-card">
      <h4>Revenus par formation</h4>
      ${topByRevenue.map(item => `
        <div class="advanced-row">
          <span>${escapeHtml(item.label)}</span>
          <div class="analytics-track"><div class="analytics-fill tuition" style="width: ${(item.revenue / maxRevenue) * 100}%"></div></div>
          <strong>${formatCompactMoney(item.revenue)}</strong>
        </div>
      `).join("") || `<p class="muted">Aucun revenu sur l'année active.</p>`}
    </div>
    <div class="advanced-list-card">
      <h4>Synthèse archive</h4>
      <p><strong>${escapeHtml(year)}</strong> est l'année active utilisée pour les statistiques avancées.</p>
      <p>Anciennes années marquées archive : <strong>${archived.length ? archived.join(", ") : "aucune"}</strong>.</p>
      <p>Solde net année : <strong>${formatMoney(incomeTotalForYear(year) - expenses)}</strong>.</p>
    </div>
  `;
}

function renderDashboardAnalytics({ tuitionPaid, annexPaid, totalExpenses, totalDue }) {
  if (!ids.dashboardFinanceBars || !ids.dashboardTuitionRing || !ids.dashboardCourseBars) return;
  const safeAmount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const totalExpected = (Array.isArray(state.enrollments) ? state.enrollments : [])
    .reduce((sum, enrollment) => sum + safeAmount(tuitionExpectedForEnrollment(enrollment)), 0);
  const recoveryRate = totalExpected > 0 ? Math.round((tuitionPaid / totalExpected) * 100) : 0;
  const clampedRate = Math.max(0, Math.min(100, recoveryRate));
  const financeItems = [
    { label: "Scolarité", value: safeAmount(tuitionPaid), className: "tuition" },
    { label: "Annexes", value: safeAmount(annexPaid), className: "annex" },
    { label: "Dépenses", value: safeAmount(totalExpenses), className: "expense" },
    { label: "Reste", value: safeAmount(totalDue), className: "balance" }
  ];
  const maxFinance = Math.max(1, ...financeItems.map(item => item.value));

  ids.dashboardFinanceBars.innerHTML = `
    <h4>Flux financiers</h4>
    ${financeItems.map(item => `
      <div class="analytics-bar-row">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${formatMoney(item.value)}</span>
        </div>
        <div class="analytics-track">
          <div class="analytics-fill ${item.className}" style="width: ${(item.value / maxFinance) * 100}%"></div>
        </div>
        <em>${formatCompactMoney(item.value)}</em>
      </div>
    `).join("")}
  `;

  ids.dashboardTuitionRing.style.setProperty("--progress", `${clampedRate}%`);
  ids.dashboardTuitionRing.innerHTML = `
    <strong>${clampedRate}%</strong>
    <span>recouvré</span>
  `;
  ids.dashboardTuitionDetails.innerHTML = `
    <strong>Recouvrement scolarité</strong>
    <span>${formatMoney(tuitionPaid)} encaissés</span>
    <span>${formatMoney(totalExpected)} attendus</span>
  `;

  const courses = Array.isArray(state.courses) ? state.courses.filter(Boolean) : [];
  const enrollments = Array.isArray(state.enrollments) ? state.enrollments.filter(Boolean) : [];
  const courseItems = courses.map(course => {
    const courseEnrollments = enrollments.filter(enrollment => Number(enrollment.courseId) === Number(course.id) && !isInactiveTuitionEnrollment(enrollment));
    return {
      label: course.code || course.name,
      value: courseEnrollments.length
    };
  }).filter(item => item.value > 0);
  const maxCourse = Math.max(1, ...courseItems.map(item => item.value));
  ids.dashboardCourseBars.innerHTML = `
    <h4>Inscriptions par formation</h4>
    ${courseItems.map(item => `
      <div class="course-analytics-row">
        <span>${escapeHtml(item.label)}</span>
        <div class="analytics-track">
          <div class="analytics-fill course" style="width: ${(item.value / maxCourse) * 100}%"></div>
        </div>
        <strong>${item.value}</strong>
      </div>
    `).join("") || `<p class="muted">Aucune inscription</p>`}
  `;
}

function onlineRequestStatusLabel(status) {
  const labels = {
    nouvelle: "Nouvelle demande",
    verification: "En vérification",
    complement: "Complément demandé",
    "dossier-incomplet": "Dossier incomplet",
    "paiement-attendu": "Paiement attendu",
    acceptee: "Acceptée",
    refusee: "Refusée",
    convertie: "Convertie en inscription"
  };
  return labels[status] || status || "Nouvelle demande";
}

function renderOnlineRequests() {
  if (!ids.onlineRequestsTable) return;
  const query = document.getElementById("onlineRequestSearch")?.value.trim().toLowerCase() || "";
  const statusFilter = document.getElementById("onlineRequestStatusFilter")?.value || "";
  const requests = [...(state.onlineRegistrationRequests || [])]
    .filter(item => {
      const course = getCourse(item.courseId);
      const haystack = [
        item.requestNumber,
        item.lastName,
        item.firstName,
        item.phone,
        item.email,
        item.source,
        item.message,
        course?.name,
        course?.code
      ].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (!statusFilter || item.status === statusFilter);
    })
    .sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));

  ids.onlineRequestCount.textContent = `${requests.length} sur ${(state.onlineRegistrationRequests || []).length}`;
  ids.onlineRequestsTable.innerHTML = requests.map(item => {
    const course = getCourse(item.courseId);
    const canConvert = !["convertie", "refusee"].includes(String(item.status || ""));
    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.requestNumber || `DEM-${item.id}`)}</strong>
          <div class="muted">${formatDateTime(new Date(item.submittedAt || Date.now()))}</div>
          <div class="muted">Source : ${escapeHtml(item.source || "-")}</div>
        </td>
        <td>
          <strong>${escapeHtml([item.lastName, item.firstName].filter(Boolean).join(" "))}</strong>
          <div class="muted">${escapeHtml([item.gender, item.birthDate ? formatDate(item.birthDate) : "", item.nationality].filter(Boolean).join(" - "))}</div>
          <div class="muted">${escapeHtml([item.address, item.district, item.city, item.country].filter(Boolean).join(", "))}</div>
        </td>
        <td>
          <strong>${escapeHtml(course?.name || "-")}</strong>
          <div class="muted">${escapeHtml(item.preferredCourseType || "Type de cours non precise")}</div>
          <div class="muted">${escapeHtml(item.message || "")}</div>
        </td>
        <td>
          ${escapeHtml(item.phone || "-")}
          <div class="muted">${escapeHtml(item.email || "")}</div>
          <div class="muted">Urgence : ${escapeHtml([item.emergencyName, item.emergencyPhone].filter(Boolean).join(" - ") || "-")}</div>
        </td>
        <td><span class="status ${statusClass(item.status)}">${escapeHtml(onlineRequestStatusLabel(item.status))}</span></td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="online-request-status" data-id="${item.id}" data-status="verification">Vérifier</button>
            <button class="chip-button" type="button" data-action="online-request-status" data-id="${item.id}" data-status="dossier-incomplet">Dossier incomplet</button>
            <button class="chip-button" type="button" data-action="online-request-status" data-id="${item.id}" data-status="paiement-attendu">Paiement attendu</button>
            <button class="chip-button" type="button" data-action="online-request-status" data-id="${item.id}" data-status="acceptee">Accepter</button>
            ${canConvert ? `<button class="chip-button success" type="button" data-action="convert-online-request" data-id="${item.id}">Convertir</button>` : ""}
            <button class="chip-button danger" type="button" data-action="online-request-status" data-id="${item.id}" data-status="refusee">Refuser</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(6, "Aucune demande en ligne");
}

function studentCourseIds(studentId) {
  const ids = new Set();
  state.enrollments
    .filter(enrollment => Number(enrollment.studentId) === Number(studentId))
    .forEach(enrollment => {
      if (enrollment.courseId) ids.add(Number(enrollment.courseId));
    });
  return ids;
}

function renderStudents() {
  const query = normalizeSearchText(document.getElementById("studentSearch").value);
  const status = document.getElementById("studentStatusFilter").value;
  const courseFilter = document.getElementById("studentCourseFilter")?.value || "";
  const sourceFilter = document.getElementById("studentSourceFilter")?.value || "";
  const locationFilter = normalizeSearchText(document.getElementById("studentLocationFilter")?.value || "");
  const filtered = state.students.filter(student => {
    const courseIds = studentCourseIds(student.id);
    const desiredCourseId = Number(student.desiredCourseId || 0);
    const haystack = [
      student.matricule,
      student.firstName,
      student.lastName,
      student.phone,
      student.phone2,
      student.email,
      student.address,
      student.district,
      student.city,
      student.nationality,
      student.studyLevel,
      student.profession,
      student.source,
      student.observation
    ]
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const locationHaystack = normalizeSearchText([student.district, student.city, student.address].join(" "));
    const matchesCourse = !courseFilter || courseIds.has(Number(courseFilter)) || desiredCourseId === Number(courseFilter);
    return (!query || haystack.includes(query)) &&
      (!status || student.status === status) &&
      matchesCourse &&
      (!sourceFilter || student.source === sourceFilter) &&
      (!locationFilter || locationHaystack.includes(locationFilter));
  });

  ids.studentCount.textContent = `${filtered.length} sur ${state.students.length}`;
  ids.studentsTable.innerHTML = filtered.map(student => `
    <tr>
      <td>${escapeHtml(student.matricule)}</td>
      <td>
        <div class="person-cell">
          ${personPhotoHtml(student, "ET")}
          <div>
            <strong>${escapeHtml(fullName(student))}</strong>
            <div class="muted">${escapeHtml(student.email || student.address || "")}</div>
            <div class="person-details-line">
              ${escapeHtml([
                student.gender ? `Sexe ${student.gender}` : "",
                student.birthDate ? `Né(e) le ${formatDate(student.birthDate)}` : "",
                student.phone2 ? `Tel. secondaire ${student.phone2}` : "",
                student.emergencyPhone ? `Personne à contacter ${student.emergencyPhone}` : ""
              ].filter(Boolean).join(" · ") || "Informations à compléter")}
            </div>
            <div class="muted">${escapeHtml([
              student.birthPlace ? `Lieu: ${student.birthPlace}` : "",
              student.nationality ? `Nationalite: ${student.nationality}` : "",
              student.desiredCourseId ? `Formation souhaitee: ${getCourse(student.desiredCourseId)?.name || ""}` : "",
              student.source ? `Source: ${student.source}` : "",
              student.documentStatus ? `Documents: ${student.documentStatus}` : "",
              student.paymentResponsible ? `Paiement: ${student.paymentResponsible}` : ""
            ].filter(Boolean).join(" - "))}</div>
            <div class="muted">${escapeHtml(personDocumentSummary(student))}</div>
            <div>${documentCompletionBadge(student, "student")}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(student.phone || "-")}</td>
      <td><span class="status ${statusClass(student.status)}">${escapeHtml(student.status)}</span></td>
      <td>
        <div class="actions">
          <button class="chip-button success" type="button" data-action="enroll-student" data-id="${student.id}">Inscrire</button>
          <button class="chip-button" type="button" data-action="print-student-file" data-id="${student.id}">Fiche</button>
          <button class="chip-button" type="button" data-action="edit-student" data-id="${student.id}">Modifier</button>
          <button class="chip-button danger" type="button" data-action="delete-student" data-id="${student.id}">${isCleanupModeActive() ? "Supprimer" : "Archiver"}</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucun étudiant");
}

function renderCourses() {
  const query = document.getElementById("courseSearch")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("courseStatusFilter")?.value || "";
  const courses = state.courses.filter(course => {
    const haystack = [course.code, course.name, course.duration, course.description].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || course.status === status);
  });
  ids.courseCount.textContent = `${courses.length} sur ${state.courses.length}`;
  ids.coursesTable.innerHTML = courses.map(course => `
    <tr>
      <td>${escapeHtml(course.code)}</td>
      <td>
        <strong>${escapeHtml(course.name)}</strong>
        <div class="muted">${escapeHtml(course.description || "")}</div>
        <div class="muted">${escapeHtml(courseFees(course).map(fee => `${fee.label}: ${formatMoney(fee.amount)}`).join(" | ") || "Aucun frais détaillé")}</div>
      </td>
      <td>${escapeHtml(course.duration || "-")}</td>
      <td>${formatMoney(courseCost(course))}</td>
      <td>
        <div class="actions">
          <button class="chip-button" type="button" data-action="edit-course" data-id="${course.id}">Modifier</button>
          <button class="chip-button danger" type="button" data-action="delete-course" data-id="${course.id}">Supprimer</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucune formation");
}

function renderGroups() {
  const courseFilter = document.getElementById("groupCourseFilter")?.value || "";
  const sessionFilter = document.getElementById("groupSessionFilter")?.value || "";
  const statusFilter = document.getElementById("groupStatusFilter")?.value || "";
  const groups = state.groups.filter(group =>
    (!courseFilter || String(group.courseId) === courseFilter) &&
    (!sessionFilter || String(group.sessionType || "jour") === sessionFilter) &&
    (!statusFilter || String(group.status || "") === statusFilter)
  );
  ids.groupCount.textContent = `${groups.length} sur ${state.groups.length}`;
  ids.groupsTable.innerHTML = groups.map(group => {
    const course = getCourse(group.courseId);
    const trainer = getTrainer(group.trainerId);
    const count = state.enrollments.filter(enrollment => Number(enrollment.groupId) === Number(group.id)).length;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(group.name)}</strong>
          <div class="muted">${escapeHtml(trainerName(trainer) || group.trainer || "Formateur non précisé")}</div>
        </td>
        <td>${escapeHtml(course?.name || "-")}</td>
        <td><span class="status ${String(group.sessionType || "jour") === "soir" ? "termine" : String(group.sessionType || "jour") === "ligne" ? "excuse" : "active"}">${escapeHtml(groupSessionLabel(group))}</span></td>
        <td>${count}${group.capacity ? ` / ${group.capacity}` : ""}</td>
        <td>${formatDate(group.startDate)} - ${formatDate(group.endDate)}</td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="edit-group" data-id="${group.id}">Modifier</button>
            <button class="chip-button danger" type="button" data-action="delete-group" data-id="${group.id}">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(6, "Aucune promotion");
}

function feeSummaryHtml(course, enrollment = null) {
  if (!course) return `<p class="muted">Choisissez une formation pour afficher les frais.</p>`;
  const selectedVersion = getCourseVersion(course, document.getElementById("enrollmentCourseVersion")?.value) || activeCourseVersion(course);
  const summary = courseFeeSummary(course, enrollment ? { enrollment } : { versionId: selectedVersion?.id });
  const rows = summary.fees.map(fee => {
    const paid = enrollment ? feePaidAmount(enrollment.id, fee) : 0;
    const rest = enrollment ? feeBalance(enrollment, fee) : Number(fee.amountFinal ?? fee.amount ?? 0);
    return `
      <div class="fee-preview-item">
        <strong>${escapeHtml(fee.label)}</strong>
        <span>${escapeHtml(feeCategoryLabel(fee.category))}</span>
        <span>${formatMoney(fee.amountFinal ?? fee.amount)}</span>
        ${enrollment ? `<span>Payé ${formatMoney(paid)} | Reste ${formatMoney(rest)}</span>` : ""}
        <span>${fee.required ? "Obligatoire" : "Facultatif"}${fee.once ? " | Une seule fois" : ""}</span>
      </div>
    `;
  }).join("") || `<p class="muted">Aucun frais actif pour cette formation.</p>`;
  return `
    ${rows}
    <div class="fee-preview-total">
      <span>Scolarité : <strong>${formatMoney(summary.tuition)}</strong></span>
      <span>Annexes obligatoires : <strong>${formatMoney(summary.requiredAnnex)}</strong></span>
      <span>Total à prévoir : <strong>${formatMoney(summary.grandTotal)}</strong></span>
    </div>
  `;
}

function renderCourseFeePreview(courseId = document.getElementById("courseForm")?.dataset.editId || 0) {
  const target = document.getElementById("courseFeePreview");
  if (!target) return;
  const course = getCourse(courseId);
  target.innerHTML = course ? feeSummaryHtml(course) : `<p class="muted">Enregistrez la formation puis gérez ses frais dans Paramètres.</p>`;
}

function renderEnrollmentFeeSummary() {
  const target = document.getElementById("enrollmentFeeSummary");
  if (!target) return;
  const enrollment = getEnrollment(document.getElementById("enrollmentForm")?.dataset.editId || 0);
  const course = getCourse(document.getElementById("enrollmentCourse")?.value);
  target.innerHTML = feeSummaryHtml(course, enrollment || null);
}

function renderEnrollments() {
  const query = normalizeSearchText(document.getElementById("enrollmentSearch")?.value || "");
  const courseFilter = document.getElementById("enrollmentCourseFilter")?.value || "";
  const groupFilter = document.getElementById("enrollmentGroupFilter")?.value || "";
  const statusFilter = document.getElementById("enrollmentStatusFilter")?.value || "";
  const balanceFilter = document.getElementById("enrollmentBalanceFilter")?.value || "";
  const fromDate = document.getElementById("enrollmentFromFilter")?.value || "";
  const toDate = document.getElementById("enrollmentToFilter")?.value || "";
  const enrollments = state.enrollments.filter(enrollment => {
    const student = getStudent(enrollment.studentId);
    const course = getCourse(enrollment.courseId);
    const group = getGroup(enrollment.groupId);
    const balance = balanceForEnrollment(enrollment);
    const haystack = normalizeSearchText([fullName(student), student?.matricule, student?.phone, course?.name, course?.code, group?.name, enrollment.academicYear, enrollment.observation].join(" "));
    return (!query || haystack.includes(query)) &&
      (!courseFilter || String(enrollment.courseId) === courseFilter) &&
      (!groupFilter || String(enrollment.groupId) === groupFilter) &&
      (!statusFilter || normalizeEnrollmentStatus(enrollment.status) === statusFilter) &&
      (!balanceFilter || (balanceFilter === "due" ? balance > 0 : balance <= 0)) &&
      (!fromDate || String(enrollment.date || "") >= fromDate) &&
      (!toDate || String(enrollment.date || "") <= toDate);
  });
  ids.enrollmentCount.textContent = `${enrollments.length} sur ${state.enrollments.length}`;
  ids.enrollmentsTable.innerHTML = enrollments.map(enrollment => {
    const student = getStudent(enrollment.studentId);
    const course = getCourse(enrollment.courseId);
    const group = getGroup(enrollment.groupId);
    const paid = paidAmount(enrollment.id);
    const annexPaid = annexPaidAmount(enrollment.id);
    const balance = balanceForEnrollment(enrollment);
    return `
      <tr>
        <td>${escapeHtml(fullName(student))}</td>
        <td>${escapeHtml(course?.name || "-")}</td>
        <td>
          <strong>${escapeHtml(group?.name || "-")}</strong>
          <div class="muted">${escapeHtml(groupSessionLabel({ sessionType: enrollmentCourseType(enrollment) }))}</div>
          <div class="muted">${escapeHtml(enrollment.academicYear || group?.year || "")}</div>
        </td>
        <td>
          <strong>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</strong>
          <div class="amount-positive">${formatMoney(paid)} payé</div>
          <div class="muted">Inscription ${formatMoney(enrollment.registrationFee || 0)}</div>
        </td>
        <td>${formatMoney(annexPaid)}</td>
        <td>
          <span class="status ${statusClass(enrollment.status)}">${escapeHtml(enrollment.status || "-")}</span>
          <div class="${balance > 0 ? "amount-danger" : "amount-positive"}">${formatMoney(balance)}</div>
        </td>
        <td>
          <div class="actions">
            <button class="chip-button success" type="button" data-action="pay-enrollment" data-id="${enrollment.id}">Payer</button>
            <button class="chip-button" type="button" data-action="print-enrollment" data-id="${enrollment.id}">Fiche</button>
            <button class="chip-button" type="button" data-action="print-attestation" data-id="${enrollment.id}">Attestation</button>
            <button class="chip-button" type="button" data-action="print-contract" data-id="${enrollment.id}">Contrat</button>
            <button class="chip-button" type="button" data-action="edit-enrollment" data-id="${enrollment.id}">Modifier</button>
            <button class="chip-button danger" type="button" data-action="delete-enrollment" data-id="${enrollment.id}">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(7, "Aucune inscription");
}

function renderPayments() {
  const allowControl = canControlPayments();
  const query = document.getElementById("paymentSearch")?.value.trim().toLowerCase() || "";
  const category = document.getElementById("paymentCategoryFilter")?.value || "";
  const method = document.getElementById("paymentMethodFilter")?.value || "";
  const month = document.getElementById("paymentMonthFilter")?.value || "";
  const payments = state.payments.filter(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : undefined;
    const tuition = isTuitionPayment(payment);
    const haystack = [payment.receiptNumber, fullName(student), payment.reason, payment.method, payment.date].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!category || (category === "tuition" ? tuition : !tuition)) &&
      (!method || payment.method === method) &&
      (!month || String(payment.date).startsWith(month));
  });
  ids.paymentCount.textContent = `${payments.length} sur ${state.payments.length}`;
  ids.paymentsTable.innerHTML = [...payments].reverse().map(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : undefined;
    const linkedFee = enrollmentFeeFromKey(payment.reasonKey, payment.enrollmentId) || courseFeeFromKey(payment.reasonKey);
    const categoryLabel = linkedFee ? feeCategoryLabel(linkedFee.category) : (isTuitionPayment(payment) ? "Scolarité" : "Annexe");
    return `
      <tr>
        <td>${escapeHtml(payment.receiptNumber)}</td>
        <td>${escapeHtml(fullName(student))}</td>
        <td>${escapeHtml(payment.reason || "-")}</td>
        <td><span class="status ${isTuitionPayment(payment) ? "active" : "termine"}">${escapeHtml(categoryLabel)}</span></td>
        <td class="amount-positive">${formatMoney(payment.amount)}</td>
        <td>${escapeHtml(payment.method)}</td>
        <td>${formatDate(payment.date)}</td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="print-receipt" data-id="${payment.id}">Reçu</button>
            ${allowControl ? `<button class="chip-button" type="button" data-action="edit-payment" data-id="${payment.id}">Modifier</button>` : ""}
            ${allowControl ? `<button class="chip-button danger" type="button" data-action="delete-payment" data-id="${payment.id}">Supprimer</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(8, "Aucun paiement");
  const auditItems = [...state.paymentAuditLog].reverse();
  ids.paymentAuditCount.textContent = `${auditItems.length} action(s)`;
  ids.paymentAuditTable.innerHTML = auditItems.map(item => {
    const source = item.before || item.after || {};
    const enrollment = getEnrollment(source.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : undefined;
    return `
      <tr>
        <td>${formatDate(String(item.date || "").slice(0, 10))}</td>
        <td><span class="status ${item.action === "Suppression" ? "annulee" : "en-attente"}">${escapeHtml(item.action || "-")}</span></td>
        <td>${escapeHtml(item.receiptNumber || source.receiptNumber || "-")}</td>
        <td>${escapeHtml(fullName(student))}</td>
        <td>
          <strong>${escapeHtml(source.reason || "-")}</strong>
          <div class="muted">${escapeHtml(source.method || "")} ${source.date ? `- ${formatDate(source.date)}` : ""}</div>
        </td>
        <td class="amount-danger">${formatMoney(source.amount || 0)}</td>
        <td>${escapeHtml(item.operator || "-")}</td>
        <td>${escapeHtml(item.controlReason || "-")}</td>
      </tr>
    `;
  }).join("") || emptyRow(8, "Aucune correction");
  updatePaymentBalance();
}

function renderCash() {
  const entries = cashLedgerEntries();
  ids.cashBalance.textContent = `Solde : ${formatMoney(netCashTotal())}`;
  ids.cashCount.textContent = `${entries.length} opération(s)`;
  ids.cashTable.innerHTML = entries.map(entry => {
    const isIncome = entry.type === "income";
    return `
      <tr>
        <td>${formatDate(entry.date)}</td>
        <td><span class="status ${isIncome ? "active" : "annulee"}">${isIncome ? "Entrée" : "Dépense"}</span></td>
        <td>
          <strong>${escapeHtml(entry.category || "-")}</strong>
          <div class="muted">${escapeHtml(entry.description || "")}</div>
          ${entry.locked && entry.source !== "cash" ? `<div class="muted">Mouvement automatique</div>` : ""}
          ${entry.closedAt ? `<div class="muted">Cloturee par ${escapeHtml(entry.closedBy || "-")} le ${escapeHtml(formatDateTime(entry.closedAt))}</div>` : ""}
        </td>
        <td class="${isIncome ? "amount-positive" : "amount-danger"}">${formatMoney(entry.amount)}</td>
        <td>${escapeHtml(entry.method || "-")}</td>
        <td>
          <div class="actions">
            ${entry.locked && entry.source !== "cash"
              ? `<span class="status en-attente">Auto</span>`
              : entry.closedAt && !isAdmin()
                ? `<span class="status termine">Cloturee</span>`
              : `<button class="chip-button danger" type="button" data-action="delete-cash-entry" data-id="${entry.rawId}">Supprimer</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(6, "Aucune opération de caisse");
}

function renderAttendance() {
  const groupId = Number(document.getElementById("attendanceGroup").value);
  const enrolled = state.enrollments
    .filter(enrollment => Number(enrollment.groupId) === groupId && !isInactiveTuitionEnrollment(enrollment))
    .map(enrollment => getStudent(enrollment.studentId))
    .filter(Boolean);

  ids.attendanceTotal.textContent = `${enrolled.length} étudiant(s)`;
  ids.attendanceList.innerHTML = enrolled.map(student => `
    <div class="attendance-row">
      <div class="student-line">
        <strong>${escapeHtml(fullName(student))}</strong>
        <span>${escapeHtml(student.matricule)}</span>
      </div>
      <select data-attendance-student="${student.id}">
        <option value="present">Présent</option>
        <option value="absent">Absent</option>
        <option value="retard">Retard</option>
        <option value="excuse">Excusé</option>
      </select>
    </div>
  `).join("") || `<p class="muted">Aucun étudiant inscrit dans cette promotion.</p>`;

  ids.attendanceCount.textContent = `${state.attendanceSessions.length} séance(s)`;
  ids.attendanceTable.innerHTML = [...state.attendanceSessions].reverse().map(session => {
    const group = getGroup(session.groupId);
    const present = session.records.filter(record => record.status === "present").length;
    const absent = session.records.filter(record => record.status === "absent").length;
    const late = session.records.filter(record => record.status === "retard").length;
    return `
      <tr>
        <td>${formatDate(session.date)}</td>
        <td>
          <strong>${escapeHtml(group?.name || "-")}</strong>
          <div class="muted">${escapeHtml(session.topic || "")}</div>
        </td>
        <td>${present}</td>
        <td>${absent}</td>
        <td>${late}</td>
      </tr>
    `;
  }).join("") || emptyRow(5, "Aucun appel enregistré");
}

function renderTrainerAttendance() {
  const trainers = state.trainers.filter(trainer => (trainer.status || "actif") !== "archive");

  ids.trainerAttendanceTotal.textContent = `${trainers.length} professeur(s)`;
  ids.trainerAttendanceList.innerHTML = trainers.map(trainer => `
    <div class="attendance-row">
      <div class="student-line">
        <strong>${escapeHtml(trainerName(trainer))}</strong>
        <span>${escapeHtml(trainer.modules || trainer.specialty || "")}</span>
      </div>
      <select data-attendance-trainer="${trainer.id}">
        <option value="present">Présent</option>
        <option value="absent">Absent</option>
        <option value="retard">Retard</option>
        <option value="excuse">Excusé</option>
      </select>
    </div>
  `).join("") || `<p class="muted">Aucun professeur enregistré.</p>`;

  ids.trainerAttendanceCount.textContent = `${state.trainerAttendanceSessions.length} appel(s)`;
  ids.trainerAttendanceTable.innerHTML = [...state.trainerAttendanceSessions].reverse().map(session => {
    const present = session.records.filter(record => record.status === "present").length;
    const absent = session.records.filter(record => record.status === "absent").length;
    const late = session.records.filter(record => record.status === "retard").length;
    return `
      <tr>
        <td>${formatDate(session.date)}</td>
        <td>
          <strong>${session.records.length} professeur(s)</strong>
          <div class="muted">${escapeHtml(session.topic || "")}</div>
        </td>
        <td>${present}</td>
        <td>${absent}</td>
        <td>${late}</td>
      </tr>
    `;
  }).join("") || emptyRow(5, "Aucun appel professeur enregistré");
}

function renderTrainers() {
  const query = document.getElementById("trainerSearch")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("trainerStatusFilter")?.value || "";
  const trainers = state.trainers.filter(trainer => {
    const haystack = [trainer.firstName, trainer.lastName, trainer.phone, trainer.email, trainer.specialty, trainer.modules].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || trainer.status === status);
  });
  ids.trainerCount.textContent = `${trainers.length} sur ${state.trainers.length}`;
  ids.trainersTable.innerHTML = trainers.map(trainer => `
    <tr>
      <td>
        <div class="person-cell">
          ${personPhotoHtml(trainer, "FO")}
          <div>
            <strong>${escapeHtml(trainerName(trainer))}</strong>
            <div class="muted">${escapeHtml(trainer.modules || "")}</div>
            <div class="person-details-line">${escapeHtml(trainer.specialty || trainer.phone || "Informations à compléter")}</div>
            <div class="muted">${escapeHtml(personDocumentSummary(trainer))}</div>
            <div>${documentCompletionBadge(trainer, "trainer")}</div>
          </div>
        </div>
      </td>
      <td>
        ${escapeHtml(trainer.phone || "-")}
        <div class="muted">${escapeHtml(trainer.email || "")}</div>
      </td>
      <td>${escapeHtml(trainer.specialty || "-")}</td>
      <td><span class="status ${statusClass(trainer.status)}">${escapeHtml(trainer.status || "actif")}</span></td>
      <td>
        <div class="actions">
          <button class="chip-button" type="button" data-action="edit-trainer" data-id="${trainer.id}">Modifier</button>
          <button class="chip-button danger" type="button" data-action="delete-trainer" data-id="${trainer.id}">Supprimer</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucun formateur");
}

function renderStaff() {
  const query = document.getElementById("staffSearch")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("staffStatusFilter")?.value || "";
  const members = state.staffMembers.filter(member => {
    const haystack = [member.firstName, member.lastName, member.role, member.phone, member.email].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || member.status === status);
  });
  const totalPaid = staffPaymentsTotal();
  ids.staffCount.textContent = `${members.length} membre(s)`;
  ids.staffPaymentTotal.textContent = formatMoney(totalPaid);
  ids.staffTable.innerHTML = members.map(member => `
    <tr>
      <td>
        <div class="person-cell">
          ${personPhotoHtml(member, "PE")}
          <div>
            <strong>${escapeHtml(staffName(member))}</strong>
            <div class="muted">${escapeHtml(member.phone || member.email || "")}</div>
            <div class="person-details-line">${escapeHtml([member.role, member.email].filter(Boolean).join(" · ") || "Informations à compléter")}</div>
            <div class="muted">${escapeHtml(personDocumentSummary(member))}</div>
            <div>${documentCompletionBadge(member, "staff")}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(member.role || "-")}</td>
      <td>${formatMoney(member.salary)}</td>
      <td><span class="status ${statusClass(member.status)}">${escapeHtml(member.status || "actif")}</span></td>
      <td>
        <div class="actions">
          <button class="chip-button" type="button" data-action="edit-staff" data-id="${member.id}">Modifier</button>
          <button class="chip-button danger" type="button" data-action="delete-staff" data-id="${member.id}">Supprimer</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucun personnel");

  ids.staffPaymentCount.textContent = `${state.staffPayments.length} paiement(s)`;
  ids.staffPaymentsTable.innerHTML = [...state.staffPayments].reverse().map(payment => {
    const beneficiary = payrollBeneficiary(payment);
    return `
      <tr>
        <td>${formatDate(payment.date)}</td>
        <td>
          <strong>${escapeHtml(beneficiary.name)}</strong>
          <div class="muted">${escapeHtml(beneficiary.role)}</div>
          <div class="muted">${escapeHtml(payment.note || "")}</div>
        </td>
        <td>${escapeHtml(payment.period || "-")}</td>
        <td>${escapeHtml(payment.reason || "-")}</td>
        <td class="amount-danger">${formatMoney(payment.amount)}</td>
        <td>${escapeHtml(payment.method || "-")}</td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="print-payroll-slip" data-id="${payment.id}">Fiche de paie</button>
            <button class="chip-button danger" type="button" data-action="delete-staff-payment" data-id="${payment.id}">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(7, "Aucun paiement personnel");
}

function renderEvaluations() {
  document.getElementById("studentGradeDate").value ||= today();
  document.getElementById("studentGradeMaxScore").value ||= 20;
  document.getElementById("studentGradeCoefficient").value ||= 1;
  updateEvaluationStudents();
  renderGradeStudentSearch();
  renderStudentGradeHistory();
  updateStudentGradeDecision();
  ids.evaluationCount.textContent = `${state.evaluations.length} evaluation(s)`;
  ids.evaluationsTable.innerHTML = [...state.evaluations].reverse().map(evaluation => {
    const group = getGroup(evaluation.groupId);
    const trainer = getTrainer(evaluation.trainerId);
    const makeup = evaluationMakeupStats(evaluation);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(evaluation.title)}</strong>
          <div class="muted">${escapeHtml(evaluation.type || "-")} - ${escapeHtml(trainerName(trainer))}</div>
        </td>
        <td>${escapeHtml(group?.name || "-")}</td>
        <td>${formatDate(evaluation.date)}</td>
        <td>
          ${formatAverage(evaluation)}
          <div class="muted">${makeup.count} rattrapage(s) - ${formatMoney(makeup.amount)}</div>
        </td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="print-grades" data-id="${evaluation.id}">PV notes</button>
            <button class="chip-button" type="button" data-action="edit-evaluation" data-id="${evaluation.id}">Modifier</button>
            <button class="chip-button danger" type="button" data-action="delete-evaluation" data-id="${evaluation.id}">Supprimer</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(5, "Aucune evaluation");
}

function renderReports() {
  const totalPaid = paymentsTotal();
  const tuitionPaid = tuitionPaymentsTotal();
  const annexPaid = annexPaymentsTotal();
  const otherIncome = cashIncomeTotal();
  const totalExpenses = cashExpenseTotal();
  const month = today().slice(0, 7);
  const monthPaid = state.payments
    .filter(payment => String(payment.date).startsWith(month))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const monthOtherIncome = state.cashEntries
    .filter(entry => entry.type === "income" && String(entry.date).startsWith(month))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const monthExpenses = state.cashEntries
    .filter(entry => entry.type === "expense" && String(entry.date).startsWith(month))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const totalExpected = state.enrollments.reduce((sum, enrollment) => sum + tuitionExpectedForEnrollment(enrollment), 0);
  const totalBalance = state.enrollments.reduce((sum, enrollment) => sum + balanceForEnrollment(enrollment), 0);
  const feeTotals = paymentsTotalByFeeCategory();
  const feeReportRows = ["scolarite", "inscription", "documentation", "equipement", "tenue", "examen", "rattrapage", "certificat", "autre"]
    .filter(category => Number(feeTotals[category] || 0) > 0)
    .map(category => [`Total ${feeCategoryLabel(category).toLowerCase()}`, formatMoney(feeTotals[category])]);

  ids.financialReport.innerHTML = [
    ["Scolarité attendue", formatMoney(totalExpected)],
    ["Scolarité encaissée", formatMoney(tuitionPaid)],
    ["Frais annexes encaissés", formatMoney(annexPaid)],
    ...feeReportRows,
    ["Total paiements étudiants", formatMoney(totalPaid)],
    ["Autres entrées", formatMoney(otherIncome)],
    ["Dépenses", formatMoney(totalExpenses)],
    ["Solde net caisse", formatMoney(netCashTotal())],
    ["Encaissement du mois", formatMoney(monthPaid + monthOtherIncome)],
    ["Dépenses du mois", formatMoney(monthExpenses)],
    ["Reste scolarité", formatMoney(totalBalance)]
  ].map(([label, value]) => `
    <article class="mini-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  ids.reportBalancesTable.innerHTML = balances().map(item => `
    <tr>
      <td>${escapeHtml(item.student)}</td>
      <td>
        <strong>${escapeHtml(item.course)}</strong>
        <div class="muted">${escapeHtml(item.sessionType)} - Exigible ${formatMoney(item.tuitionExpected)}</div>
      </td>
      <td class="amount-positive">${formatMoney(item.paid)}</td>
      <td class="amount-danger">${formatMoney(item.balance)}</td>
    </tr>
  `).join("") || emptyRow(4, "Aucun impayé");

  const counts = state.courses.map(course => ({
    name: course.name,
    count: state.enrollments.filter(enrollment => Number(enrollment.courseId) === Number(course.id) && !isInactiveTuitionEnrollment(enrollment)).length
  }));
  const max = Math.max(1, ...counts.map(item => item.count));
  ids.courseDistribution.innerHTML = counts.map(item => `
    <div class="bar-row">
      <strong>${escapeHtml(item.name)}</strong>
      <div class="bar-track"><div class="bar-fill" style="width: ${(item.count / max) * 100}%"></div></div>
      <span>${item.count}</span>
    </div>
  `).join("");

  const scheduleRows = monthlyScheduleRows();
  ids.monthlyScheduleCount.textContent = `${scheduleRows.length} échéance(s)`;
  ids.monthlyScheduleTable.innerHTML = scheduleRows.map(row => `
    <tr>
      <td>${escapeHtml(row.month)}</td>
      <td>${escapeHtml(row.student)}</td>
      <td>${escapeHtml(row.course)}</td>
      <td>${formatMoney(row.expected)}</td>
      <td class="amount-positive">${formatMoney(row.paid)}</td>
      <td class="${row.balance > 0 ? "amount-danger" : "amount-positive"}">${formatMoney(row.balance)}</td>
    </tr>
  `).join("") || emptyRow(6, "Aucune échéance");

  renderDocumentGenerator();
  renderIndividualReport();
}

function addMonths(dateValue, count) {
  const date = new Date(`${dateValue || today()}T00:00:00`);
  date.setMonth(date.getMonth() + count);
  return date.toISOString().slice(0, 7);
}

function monthlyScheduleRows() {
  const rows = [];
  state.enrollments
    .filter(enrollment => !suppressPaymentTrackingForEnrollment(enrollment))
    .forEach(enrollment => {
      const course = getCourse(enrollment.courseId);
      const version = getCourseVersion(course, enrollment.versionId || enrollment.formationVersionId) || activeCourseVersion(course);
      const finalAmount = tuitionExpectedForEnrollment(enrollment);
      if (!finalAmount) return;
      const student = getStudent(enrollment.studentId);
      const percentages = normalizePaymentSchedulePercentages(version?.paymentSchedulePercentages);
      const totalPercent = percentages.reduce((sum, value) => sum + Number(value || 0), 0) || 100;
      const plannedAmounts = percentages.map((percentage, index) => {
        if (index === percentages.length - 1) return 0;
        return Math.round((finalAmount * Number(percentage || 0)) / totalPercent);
      });
      const allocated = plannedAmounts.reduce((sum, amount) => sum + amount, 0);
      plannedAmounts[plannedAmounts.length - 1] = Math.max(0, finalAmount - allocated);
      const fallbackMonthly = Number(course?.monthlyFee || enrollment.monthlyFee || 0);
      const scheduleAmounts = plannedAmounts.length ? plannedAmounts : [fallbackMonthly || finalAmount];
      const tuitionPaid = paidAmount(enrollment.id);
      let cumulativeExpected = 0;
      for (let index = 0; index < scheduleAmounts.length; index += 1) {
        const expected = Math.max(0, Number(scheduleAmounts[index] || 0));
        cumulativeExpected = Math.min(finalAmount, cumulativeExpected + expected);
        const cumulativeBalance = Math.max(0, cumulativeExpected - tuitionPaid);
        rows.push({
          month: addMonths(enrollment.date, index),
          student: fullName(student),
          course: course?.name || "-",
          expected,
          paid: Math.min(tuitionPaid, cumulativeExpected),
          balance: cumulativeBalance
        });
      }
    });
  return rows.sort((a, b) => String(a.month).localeCompare(String(b.month)) || a.student.localeCompare(b.student));
}

function renderIndividualReport() {
  if (!ids.individualReportStudent || !ids.individualReportSummary || !ids.individualMotifTable) return;
  const { enrollments, tuitionExpected, tuitionPaid, annexPaid, totalPaid, balance } = individualStudentReportData();

  ids.individualReportSummary.innerHTML = [
    ["Scolarité due", formatMoney(tuitionExpected)],
    ["Scolarité payée", formatMoney(tuitionPaid)],
    ["Reste scolarité", formatMoney(balance)],
    ["Frais annexes payés", formatMoney(annexPaid)],
    ["Total payé", formatMoney(totalPaid)]
  ].map(([label, value]) => `
    <article class="mini-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  const feeRows = enrollments.flatMap(enrollment => {
    const course = getCourse(enrollment.courseId);
    const group = getGroup(enrollment.groupId);
    return normalizeEnrollmentCopiedFees(enrollment).map(fee => {
      const expected = Number(fee.amountFinal ?? fee.amount ?? 0);
      const paid = feePaidAmount(enrollment.id, fee);
      const rest = feeBalance(enrollment, fee);
      const status = feePaymentStatus(enrollment, fee);
      return `
      <tr>
        <td>
          <strong>${escapeHtml(fee.label || "-")}</strong>
          <div class="muted">${escapeHtml(course?.name || "-")} - ${escapeHtml(group?.name || "-")} - ${escapeHtml(groupSessionLabel(group))}</div>
        </td>
        <td>${escapeHtml(feeCategoryLabel(fee.category))}</td>
        <td>
          <strong>${formatMoney(expected)}</strong>
          <div class="muted">Payé ${formatMoney(paid)} - Reste ${formatMoney(rest)}</div>
        </td>
        <td><span class="status ${status === "payé" ? "termine" : status === "partiel" ? "active" : "pending"}">${escapeHtml(status)}</span></td>
      </tr>
    `;
    });
  });

  ids.individualMotifTable.innerHTML = feeRows.join("") || emptyRow(4, "Aucun frais copié pour cet étudiant");
}

function individualStudentReportData(studentId = Number(ids.individualReportStudent?.value || state.students[0]?.id || 0)) {
  const student = getStudent(studentId);
  const enrollments = state.enrollments.filter(enrollment => Number(enrollment.studentId) === studentId);
  const payments = enrollments
    .flatMap(enrollment => paymentsForEnrollment(enrollment.id).map(payment => ({
      ...payment,
      enrollment,
      category: isTuitionPayment(payment) ? "Scolarite" : "Frais annexe",
      lastDate: payment.date
    })))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
  const tuitionExpected = enrollments.reduce((sum, enrollment) => sum + tuitionExpectedForEnrollment(enrollment), 0);
  const tuitionPaid = enrollments.reduce((sum, enrollment) => sum + paidAmount(enrollment.id), 0);
  const annexPaid = enrollments.reduce((sum, enrollment) => sum + annexPaidAmount(enrollment.id), 0);
  const totalPaid = tuitionPaid + annexPaid;
  const balance = Math.max(0, tuitionExpected - tuitionPaid);
  const byMotif = new Map();

  payments.forEach(payment => {
    const key = payment.reasonKey || payment.reason || "motif";
    const current = byMotif.get(key) || {
      reason: payment.reason || key,
      category: isTuitionPayment(payment) ? "Scolarité" : "Frais annexe",
      amount: 0,
      lastDate: ""
    };
    current.amount += Number(payment.amount || 0);
    if (!current.lastDate || String(payment.date).localeCompare(String(current.lastDate)) > 0) {
      current.lastDate = payment.date;
    }
    byMotif.set(key, current);
  });

  return {
    student,
    enrollments,
    payments,
    paymentsByMotif: [...byMotif.values()],
    tuitionExpected,
    tuitionPaid,
    annexPaid,
    totalPaid,
    balance
  };
}

function activeDocumentTemplates() {
  ensureDocumentTemplates();
  return state.documentTemplates
    .filter(template => template.status !== "archive")
    .map(template => ({ ...template, id: template.key }))
    .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.title).localeCompare(String(b.title)));
}

function templateByKey(key) {
  ensureDocumentTemplates();
  return state.documentTemplates.find(template => template.key === key);
}

function latestEnrollmentForStudent(studentId) {
  return state.enrollments
    .filter(enrollment => Number(enrollment.studentId) === Number(studentId))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Number(b.id) - Number(a.id))[0];
}

function documentTemplateContext({ enrollmentId = 0, studentId = 0, beneficiaryValue = "" } = {}) {
  const center = state.center || {};
  const enrollment = getEnrollment(enrollmentId) || latestEnrollmentForStudent(studentId) || state.enrollments[0];
  const student = getStudent(studentId) || getStudent(enrollment?.studentId);
  const course = getCourse(enrollment?.courseId);
  const group = getGroup(enrollment?.groupId);
  const parsedBeneficiary = parsePayrollBeneficiary(beneficiaryValue);
  const person = parsedBeneficiary.type === "trainer"
    ? getTrainer(parsedBeneficiary.id)
    : getStaffMember(parsedBeneficiary.id);
  const beneficiaryName = parsedBeneficiary.type === "trainer" ? trainerName(person) : staffName(person);
  const beneficiaryRole = parsedBeneficiary.type === "trainer" ? "Formateur" : (person?.role || "Personnel");

  return {
    centre_nom: center.name || "CFP EREXIT",
    centre_sous_titre: center.subtitle || "Centre de Formation Professionnelle",
    centre_telephone: center.phone || "",
    centre_email: center.email || "",
    centre_adresse: center.address || "",
    etudiant_nom: fullName(student),
    matricule: student?.matricule || "",
    telephone: student?.phone || person?.phone || "",
    email: student?.email || person?.email || "",
    formation: course?.name || "",
    promotion: group?.name || "",
    type_cours: groupSessionLabel(group),
    date_inscription: enrollment?.date ? formatDate(enrollment.date) : "",
    scolarite: enrollment ? formatMoney(tuitionExpectedForEnrollment(enrollment)) : "",
    scolarite_payee: enrollment ? formatMoney(paidAmount(enrollment.id)) : "",
    reste_scolarite: enrollment ? formatMoney(balanceForEnrollment(enrollment)) : "",
    beneficiaire_nom: beneficiaryName,
    fonction: beneficiaryRole,
    date: formatDate(today())
  };
}

function renderTemplateContent(content, context) {
  const resolved = String(content || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => context[key] ?? "");
  return resolved
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderDocumentGenerator() {
  if (!ids.documentGeneratorTemplate) return;
  const template = templateByKey(ids.documentGeneratorTemplate.value) || activeDocumentTemplates()[0];
  if (!template) return;
  const studentLabel = ids.documentGeneratorStudent?.closest("label");
  const beneficiaryLabel = ids.documentGeneratorBeneficiary?.closest("label");
  if (studentLabel) studentLabel.hidden = template.audience === "staff" || template.audience === "general";
  if (beneficiaryLabel) beneficiaryLabel.hidden = template.audience === "student" || template.audience === "general";
}

function printTemplateDocument(templateKey, options = {}) {
  const template = templateByKey(templateKey);
  if (!template) {
    showToast("Modèle introuvable");
    return;
  }
  const context = documentTemplateContext(options);
  const stampSrc = normalizeLogoData(state.center?.stampData);
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml(template.title)}
      <div class="custom-document-body">
        ${renderTemplateContent(template.content, context)}
      </div>
      <div class="document-signature">
        ${stampSrc ? `<img src="${escapeHtml(stampSrc)}" alt="">` : ""}
        <strong>Signature et cachet</strong>
      </div>
    </section>
  `;
  showPrintPreview();
}

function printSelectedDocumentTemplate() {
  const templateKey = ids.documentGeneratorTemplate?.value;
  if (!templateKey) {
    showToast("Choisissez un modèle");
    return;
  }
  printTemplateDocument(templateKey, {
    studentId: Number(ids.documentGeneratorStudent?.value || 0),
    beneficiaryValue: ids.documentGeneratorBeneficiary?.value || ""
  });
}

function renderDocumentTemplates() {
  if (!ids.documentTemplateList) return;
  ensureDocumentTemplates();
  const templates = [...state.documentTemplates].sort((a, b) =>
    String(a.category).localeCompare(String(b.category)) || String(a.title).localeCompare(String(b.title))
  );
  ids.documentTemplateList.innerHTML = templates.map(template => `
    <article class="document-template-card ${template.status === "archive" ? "is-archived" : ""}">
      <div>
        <strong>${escapeHtml(template.title)}</strong>
        <span>${escapeHtml(template.category)} · ${documentAudienceLabel(template.audience)} · ${template.status === "archive" ? "Archivé" : "Actif"}</span>
      </div>
      <div class="row-actions">
        <button class="chip-button" type="button" data-action="edit-document-template" data-key="${escapeHtml(template.key)}">Modifier</button>
        <button class="chip-button danger" type="button" data-action="delete-document-template" data-key="${escapeHtml(template.key)}">${template.locked ? "Archiver" : "Supprimer"}</button>
      </div>
    </article>
  `).join("") || `<p class="muted">Aucun modèle de document.</p>`;
}

function documentAudienceLabel(audience) {
  if (audience === "staff") return "Personnel";
  if (audience === "general") return "Général";
  return "Étudiant";
}

function slugifyTemplateKey(value) {
  const base = normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "modele-document";
  let key = base;
  let index = 2;
  while (state.documentTemplates.some(template => template.key === key)) {
    key = `${base}-${index}`;
    index += 1;
  }
  return key;
}

function resetDocumentTemplateForm() {
  if (!ids.documentTemplateTitle) return;
  ids.documentTemplateEditKey.value = "";
  ids.documentTemplateTitle.value = "";
  ids.documentTemplateCategory.value = "Attestation";
  ids.documentTemplateAudience.value = "student";
  ids.documentTemplateStatus.value = "active";
  ids.documentTemplateContent.value = "";
}

function editDocumentTemplate(key) {
  const template = templateByKey(key);
  if (!template || !ids.documentTemplateTitle) return;
  ids.documentTemplateEditKey.value = template.key;
  ids.documentTemplateTitle.value = template.title || "";
  ids.documentTemplateCategory.value = template.category || "Attestation";
  ids.documentTemplateAudience.value = template.audience || "student";
  ids.documentTemplateStatus.value = template.status || "active";
  ids.documentTemplateContent.value = template.content || "";
  ids.documentTemplateTitle.focus();
}

function saveDocumentTemplate(event) {
  event.preventDefault();
  const editKey = ids.documentTemplateEditKey.value;
  const payload = {
    title: ids.documentTemplateTitle.value.trim(),
    category: ids.documentTemplateCategory.value,
    audience: ids.documentTemplateAudience.value,
    status: ids.documentTemplateStatus.value,
    content: ids.documentTemplateContent.value.trim()
  };
  if (!payload.title || !payload.content) return;

  const existing = templateByKey(editKey);
  if (existing) {
    Object.assign(existing, payload);
    showToast("Modèle modifié");
  } else {
    state.documentTemplates.push({
      key: slugifyTemplateKey(payload.title),
      locked: false,
      ...payload
    });
    showToast("Modèle ajouté");
  }

  saveState();
  resetDocumentTemplateForm();
  syncSelects();
  renderDocumentTemplates();
}

function deleteDocumentTemplate(key) {
  const template = templateByKey(key);
  if (!template) return;
  if (template.locked) {
    template.status = "archive";
    showToast("Modèle archivé");
  } else {
    state.documentTemplates = state.documentTemplates.filter(item => item.key !== key);
    showToast("Modèle supprimé");
  }
  saveState();
  resetDocumentTemplateForm();
  syncSelects();
  renderDocumentTemplates();
}

function renderSettings() {
  renderUserAccessSettings();
  renderLoginHistory();
  renderAuditLog();
  renderSecuritySettings();
  renderAcademicSettings();
  setCleanupModeStatus();
  if (!canAccessView("settings")) return;

  document.getElementById("centerName").value = state.center?.name || "CFP EREXIT";
  document.getElementById("centerSubtitle").value = state.center?.subtitle || "Centre de Formation Professionnelle";
  document.getElementById("centerPhone").value = state.center?.phone || "";
  document.getElementById("centerEmail").value = state.center?.email || "";
  document.getElementById("centerAddress").value = state.center?.address || "";
  ensurePaymentMotifs();
  ids.paymentMotifsSettings.innerHTML = state.paymentMotifs.map(motif => `
    <div class="motif-row">
      <input type="text" value="${escapeHtml(motif.label)}" data-motif-label="${escapeHtml(motif.key)}" required>
      <input type="number" min="0" step="500" value="${Number(motif.amount || 0)}" data-motif-amount="${escapeHtml(motif.key)}">
      <button class="chip-button danger" type="button" data-action="delete-motif" data-key="${escapeHtml(motif.key)}" ${motif.key === "scolarite" || motif.key === MAKEUP_MOTIF_KEY ? "disabled" : ""}>Supprimer</button>
    </div>
  `).join("");

  ids.courseFeesSettings.innerHTML = state.courses.map(course => {
    ensureCourseVersions(course);
    const version = activeCourseVersion(course) || course.versions[0];
    const versionKey = `${course.id}:${version?.id || ""}`;
    const rows = courseFees(course, { activeOnly: false, versionId: version?.id })
      .map(fee => courseFeeRowHtml(course, fee, versionKey))
      .join("");
    const summary = courseFeeSummary(course, { versionId: version?.id });
    return `
      <div class="fee-row detailed-fee-row">
        <div class="course-fee-header">
          <div>
            <strong>${escapeHtml(course.name)}</strong>
            <span>${escapeHtml(course.code || "")} · ${escapeHtml(versionLabel(version))} · Scolarité ${formatMoney(summary.tuition)} · Annexes obligatoires ${formatMoney(summary.requiredAnnex)}</span>
          </div>
          <button class="chip-button success" type="button" data-action="add-course-fee" data-course-id="${course.id}">Ajouter un frais</button>
        </div>
        <div class="course-version-settings">
          <label><span>Version active</span><input type="text" value="${escapeHtml(version?.name || "")}" data-version-name="${escapeHtml(versionKey)}"></label>
          <label><span>Durée</span><input type="text" value="${escapeHtml(version?.duration || course.duration || "")}" data-version-duration="${escapeHtml(versionKey)}"></label>
          <label><span>Année</span><input type="text" value="${escapeHtml(version?.year || "")}" data-version-year="${escapeHtml(versionKey)}"></label>
          <label><span>Échéances mensuelles (%)</span><input type="text" value="${escapeHtml(normalizePaymentSchedulePercentages(version?.paymentSchedulePercentages).join(", "))}" data-version-schedule="${escapeHtml(versionKey)}" placeholder="Ex : 30, 30, 40"></label>
        </div>
        <div class="course-fee-list" data-course-fee-list="${escapeHtml(versionKey)}">${rows || `<p class="muted">Aucun frais configuré.</p>`}</div>
        <div class="course-base-fees">
          <label><span>Mensualité</span><input type="number" min="0" step="1" value="${Number(course.monthlyFee || 0)}" data-course-monthly-fee="${course.id}"></label>
        </div>
      </div>
    `;
  }).join("") || `<p class="muted">Aucune formation enregistrée.</p>`;

  renderDocumentTemplates();
  renderRequiredDocumentsSettings();
}

function renderSecuritySettings() {
  const settings = normalizeSecuritySettings(state.securitySettings);
  if (ids.idleTimeoutMinutes) ids.idleTimeoutMinutes.value = settings.idleTimeoutMinutes;
}

function renderAcademicSettings() {
  const settings = normalizeAcademicSettings(state.academicSettings);
  if (ids.activeAcademicYear) ids.activeAcademicYear.value = settings.activeYear;
  if (ids.archivedAcademicYears) ids.archivedAcademicYears.value = settings.archivedYears.join(", ");
}

function makeupSubjectsForEnrollment(enrollment) {
  if (!enrollment) return [];
  return state.evaluations.flatMap(evaluation => {
    if (Number(evaluation.groupId) !== Number(enrollment.groupId)) return [];
    const grade = (evaluation.grades || []).find(item => Number(item.studentId) === Number(enrollment.studentId));
    if (!grade || !gradeNeedsMakeup(grade.score, evaluation.maxScore || 20, grade.makeupScore)) return [];
    return [{
      evaluationId: evaluation.id,
      title: evaluation.title || "Matière",
      score: grade.score,
      makeupScore: grade.makeupScore ?? "",
      maxScore: evaluation.maxScore || 20,
      decision: gradeStatusLabel(grade.score, evaluation.maxScore || 20, grade.makeupScore)
    }];
  });
}

function makeupPaidForEnrollment(enrollmentId, excludePaymentId = 0) {
  return paymentsForEnrollment(enrollmentId)
    .filter(payment => Number(payment.id) !== Number(excludePaymentId) && isMakeupMotifKey(payment.reasonKey))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function makeupDueForEnrollment(enrollment, excludePaymentId = 0) {
  const expected = makeupSubjectsForEnrollment(enrollment).length * MAKEUP_FEE;
  return Math.max(0, expected - makeupPaidForEnrollment(enrollment?.id, excludePaymentId));
}

function renderRequiredDocumentsSettings() {
  if (!ids.requiredDocumentsSettings) return;
  const labels = [
    ["student", "Étudiants"],
    ["trainer", "Formateurs"],
    ["staff", "Personnel"]
  ];
  const required = normalizeRequiredDocuments(state.requiredDocuments);
  ids.requiredDocumentsSettings.innerHTML = labels.map(([kind, label]) => `
    <label>
      <span>${escapeHtml(label)}</span>
      <textarea rows="3" data-required-documents="${kind}" placeholder="Un document par ligne">${escapeHtml(required[kind].join("\n"))}</textarea>
    </label>
  `).join("");
}

function renderAuditLog() {
  if (!ids.auditLogTable || !ids.auditLogCount) return;
  if (!isAdmin()) {
    ids.auditLogTable.innerHTML = "";
    ids.auditLogCount.textContent = "0 action(s)";
    return;
  }
  const rows = [...(state.auditLog || [])]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 120);
  ids.auditLogCount.textContent = `${rows.length} action(s)`;
  ids.auditLogTable.innerHTML = rows.map(entry => `
    <tr>
      <td>${escapeHtml(formatDateTime(new Date(entry.at || Date.now())))}</td>
      <td>${escapeHtml(entry.section || "-")}</td>
      <td>${escapeHtml(entry.action || "-")}</td>
      <td>${escapeHtml(entry.detail || "-")}</td>
      <td>${escapeHtml(entry.operator || entry.operatorEmail || "-")}</td>
    </tr>
  `).join("") || emptyRow(5, "Aucune action enregistrée.");
}

function renderLoginHistory() {
  if (!ids.loginHistoryTable || !ids.loginHistoryCount) return;
  if (!isAdmin()) {
    ids.loginHistoryTable.innerHTML = "";
    ids.loginHistoryCount.textContent = "0 action(s)";
    return;
  }

  const rows = [...(state.loginHistory || [])]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 80);
  ids.loginHistoryCount.textContent = `${rows.length} action(s)`;
  ids.loginHistoryTable.innerHTML = rows.map(entry => `
    <tr>
      <td>${escapeHtml(formatDateTime(new Date(entry.at || Date.now())))}</td>
      <td>${escapeHtml(entry.identifier || entry.email || "-")}</td>
      <td>${escapeHtml(entry.userName || "-")}</td>
      <td><span class="status ${entry.success ? "active" : "inactive"}">${entry.success ? "Réussie" : "Refusée"}</span></td>
      <td>${escapeHtml(entry.ip || "-")}</td>
    </tr>
  `).join("") || emptyRow(5, "Aucune connexion enregistrée.");
}

function renderUserAccessSettings() {
  if (!ids.userAccessSettings) return;
  if (!isAdmin()) {
    ids.userAccessSettings.innerHTML = "";
    if (ids.passwordResetRequests) ids.passwordResetRequests.innerHTML = "";
    return;
  }

  renderPasswordResetRequests();
  if (!state.users.length) {
    ids.userAccessSettings.innerHTML = `
      <p class="muted password-reset-empty">
        Liste des utilisateurs non chargee. Rechargez la page avant de modifier les acces.
      </p>
    `;
    return;
  }

  const users = state.users;
  ids.userAccessSettings.innerHTML = users.map(user => {
    const role = user.role || "Secrétaire";
    const isUserAdmin = roleCode(role) === "administrateur" || roleCode(role) === "admin";
    const permissions = isUserAdmin ? ACCESS_VIEWS : permissionsForUser(user);
    const disabled = isUserAdmin ? "disabled" : "";
    return `
      <article class="access-card" data-user-access-row="${user.id || ""}">
        <div class="access-card-header">
          <strong>${escapeHtml(user.name || "Nouvel utilisateur")}</strong>
          ${isUserAdmin ? `<span class="status active">Accès total</span>` : `<button class="chip-button danger" type="button" data-action="delete-user-access" data-id="${user.id || ""}">Desactiver</button>`}
        </div>
        <div class="access-user-grid">
          <label>
            <span>Nom</span>
            <input type="text" value="${escapeHtml(user.name || "")}" data-user-name="${user.id || ""}" required>
          </label>
          <label>
            <span>Identifiant</span>
            <input type="text" value="${escapeHtml(user.username || "")}" data-user-username="${user.id || ""}" required>
          </label>
          <label>
            <span>Email</span>
            <input type="email" value="${escapeHtml(user.email || "")}" data-user-email="${user.id || ""}" required>
          </label>
          <label>
            <span>Profil</span>
            <select data-user-role="${user.id || ""}" ${isUserAdmin ? "disabled" : ""}>
              ${(isUserAdmin ? ["Administrateur"] : ROLE_OPTIONS.filter(option => option !== "Administrateur")).map(option => `<option value="${escapeHtml(option)}" ${option === role ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Statut</span>
            <select data-user-status="${user.id || ""}" ${isUserAdmin ? "disabled" : ""}>
              <option value="active" ${(user.status || "active") === "active" ? "selected" : ""}>Actif</option>
              <option value="inactive" ${user.status === "inactive" ? "selected" : ""}>Inactif</option>
              <option value="suspended" ${user.status === "suspended" ? "selected" : ""}>Suspendu</option>
            </select>
          </label>
          <label>
            <span>Nouveau mot de passe / réinitialisation</span>
            <input type="password" data-user-password="${user.id || ""}" placeholder="${user.id ? "Laisser vide pour garder" : "Minimum 8 caractères forts"}">
          </label>
          <label class="password-toggle-line">
            <input type="checkbox" data-toggle-password="${user.id || ""}">
            <span>Afficher</span>
          </label>
          ${user.mustChangePassword ? `<p class="muted">Changement de mot de passe requis.</p>` : ""}
        </div>
        <div class="access-checks">
          ${MANAGED_ACCESS_VIEWS.map(view => `
            <label>
              <input type="checkbox" value="${escapeHtml(view)}" data-user-permission="${user.id || ""}" ${permissions.includes(view) ? "checked" : ""} ${disabled}>
              <span>${escapeHtml(VIEW_LABELS[view])}</span>
            </label>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function strongPassword(value = "") {
  const password = String(value || "");
  const weak = ["admin123", "secret123", "compta123", "formateur123", "changeme123", "123456", "password"];
  return password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password) &&
    !weak.includes(password.toLowerCase());
}

function showPasswordChangeModal() {
  if (!ids.passwordChangeModal || !ids.passwordChangeForm) return;
  ids.passwordChangeForm.reset();
  ids.passwordChangeError.textContent = "";
  ids.passwordChangeModal.hidden = false;
  window.setTimeout(() => ids.currentPasswordChange?.focus(), 80);
}

function hidePasswordChangeModal() {
  if (!ids.passwordChangeModal) return;
  ids.passwordChangeModal.hidden = true;
  ids.passwordChangeError.textContent = "";
}

function enforcePasswordChangeIfNeeded() {
  if (currentUser?.mustChangePassword) {
    showPasswordChangeModal();
  } else {
    hidePasswordChangeModal();
  }
}

async function changeOwnPassword(event) {
  event.preventDefault();
  ids.passwordChangeError.textContent = "";
  const currentPassword = ids.currentPasswordChange.value;
  const newPassword = ids.newPasswordChange.value;
  const confirmPassword = ids.confirmPasswordChange.value;

  if (newPassword !== confirmPassword) {
    ids.passwordChangeError.textContent = "Les deux nouveaux mots de passe ne correspondent pas.";
    return;
  }
  if (!strongPassword(newPassword)) {
    ids.passwordChangeError.textContent = "Mot de passe trop faible : 8 caracteres, majuscule, minuscule, chiffre et caractere special.";
    return;
  }

  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const result = await apiRequest("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    currentUser = result.user;
    hidePasswordChangeModal();
    renderSession();
    showToast("Mot de passe mis a jour");
  } catch (error) {
    ids.passwordChangeError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

function activeTrainers() {
  return state.trainers.filter(trainer => (trainer.status || "actif") === "actif");
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roleCode(role = "") {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function renderPasswordResetRequests() {
  if (!ids.passwordResetRequests) return;
  const pending = (state.passwordResetRequests || [])
    .filter(request => request.status !== "done")
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));

  if (!pending.length) {
    ids.passwordResetRequests.innerHTML = `<p class="muted password-reset-empty">Aucune demande de réinitialisation en attente.</p>`;
    return;
  }

  ids.passwordResetRequests.innerHTML = `
    <div class="password-reset-list">
      <h4>Demandes de réinitialisation</h4>
      ${pending.map(request => {
        const user = state.users.find(item => item.email === request.email);
        return `
          <article class="password-reset-request">
            <div>
              <strong>${escapeHtml(user?.name || request.email)}</strong>
              <span>${escapeHtml(request.email)} · ${formatDateTime(new Date(request.requestedAt || Date.now()))}</span>
            </div>
            <button class="chip-button success" type="button" data-action="mark-password-reset-done" data-id="${request.id}">Marquer traité</button>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function balances() {
  return state.enrollments
    .map(enrollment => {
      const student = getStudent(enrollment.studentId);
      const course = getCourse(enrollment.courseId);
      const paid = paidAmount(enrollment.id);
      const balance = balanceForEnrollment(enrollment);
      const tuitionExpected = tuitionExpectedForEnrollment(enrollment);
      return {
        enrollment,
        student: fullName(student),
        course: course?.name || "-",
        sessionType: groupSessionLabel(getGroup(enrollment.groupId)),
        finalAmount: Number(enrollment.finalAmount ?? 0),
        tuitionExpected,
        paid,
        balance
      };
    })
    .filter(item => item.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

function requiredAnnexMotifs() {
  ensurePaymentMotifs();
  return state.paymentMotifs.filter(motif => !isTuitionMotifKey(motif.key) && Number(motif.amount || 0) > 0);
}

function paymentAlerts() {
  const alerts = [];

  state.enrollments
    .filter(enrollment => !suppressPaymentTrackingForEnrollment(enrollment))
    .forEach(enrollment => {
      const student = getStudent(enrollment.studentId);
      const course = getCourse(enrollment.courseId);
      const group = getGroup(enrollment.groupId);
      const studentLabel = fullName(student);
      const courseLabel = course?.name || "-";
      const lastTuitionDate = lastPaymentDateForEnrollment(enrollment.id, isTuitionPayment);
      const tuitionBalance = balanceForEnrollment(enrollment);

      if (tuitionBalance > 0) {
        const days = daysSince(lastTuitionDate || enrollment.date);
        const noTuitionPayment = !lastTuitionDate;
        const severity = noTuitionPayment || days >= 30 ? "danger" : days >= 20 ? "warning" : "info";
        alerts.push({
          enrollmentId: enrollment.id,
          reasonKey: "scolarite",
          severity,
          priority: severity === "danger" ? 1 : severity === "warning" ? 2 : 3,
          student: studentLabel,
          detail: courseLabel,
          message: noTuitionPayment ? "Premier paiement scolarité attendu" : days >= 30 ? "Scolarité en retard" : days >= 20 ? "Relance scolarité proche" : "Reste scolarité à suivre",
          amount: tuitionBalance,
          lastPaymentDate: lastTuitionDate,
          referenceDate: lastTuitionDate || enrollment.date,
          sessionType: groupSessionLabel(group)
        });
      }

      normalizeEnrollmentCopiedFees(enrollment)
        .filter(fee => fee.required && !isTuitionFee(fee) && fee.active !== false)
        .forEach(fee => {
        const balance = feeBalance(enrollment, fee);
        if (balance <= 0) return;
        const days = daysSince(enrollment.date);
        const key = enrollmentFeeKey(fee);
        alerts.push({
          enrollmentId: enrollment.id,
          reasonKey: key,
          severity: days >= 30 ? "warning" : "info",
          priority: days >= 30 ? 2 : 4,
          student: studentLabel,
          detail: courseLabel,
          message: `Frais non payé : ${fee.label}`,
          amount: balance,
          lastPaymentDate: "",
          referenceDate: enrollment.date,
          sessionType: groupSessionLabel(group)
        });
      });
    });

  return alerts.sort((a, b) =>
    a.priority - b.priority ||
    b.amount - a.amount ||
    String(a.referenceDate).localeCompare(String(b.referenceDate))
  );
}

function daysUntil(value) {
  if (!value) return Infinity;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.ceil((date - new Date(`${today()}T00:00:00`)) / DAY_MS);
}

function notificationSeverityRank(severity) {
  return { danger: 1, warning: 2, info: 3 }[severity] || 4;
}

function notificationSeverityLabel(severity) {
  return {
    danger: "Urgent",
    warning: "À suivre",
    info: "Info"
  }[severity] || "Info";
}

function notificationTypeLabel(type) {
  return {
    payment: "Paiement",
    document: "Document",
    makeup: "Rattrapage",
    attendance: "Présence",
    online: "Inscription en ligne",
    group: "Promotion"
  }[type] || "Notification";
}

function notificationActionHtml(notification) {
  if (notification.action === "pay") {
    return `<button class="chip-button success" type="button" data-action="pay-alert" data-id="${notification.targetId}" data-reason="${escapeHtml(notification.reasonKey || "scolarite")}">Encaisser</button>`;
  }
  if (notification.action === "student") {
    return `<button class="chip-button" type="button" data-action="edit-student" data-id="${notification.targetId}">Voir dossier</button>`;
  }
  if (notification.action === "view") {
    return `<button class="chip-button" type="button" data-action="go-view" data-view="${escapeHtml(notification.view || "dashboard")}">Ouvrir</button>`;
  }
  return `<span class="muted">-</span>`;
}

function centralNotifications() {
  const notifications = [];

  paymentAlerts().forEach(alert => {
    notifications.push({
      id: `payment-${alert.enrollmentId}-${alert.reasonKey}`,
      type: "payment",
      severity: alert.severity,
      title: alert.message,
      detail: `${alert.student} - ${alert.detail} - ${formatMoney(alert.amount)}`,
      referenceDate: alert.referenceDate || "",
      targetId: alert.enrollmentId,
      reasonKey: alert.reasonKey,
      action: "pay"
    });
  });

  state.students
    .filter(student => !["archive", "abandon", "desiste"].includes(String(student.status || "").toLowerCase()))
    .forEach(student => {
      const completion = personDocumentCompletion(student, "student");
      if (completion.completed) return;
      notifications.push({
        id: `document-student-${student.id}`,
        type: "document",
        severity: String(student.status || "").toLowerCase() === "actif" ? "danger" : "warning",
        title: "Dossier étudiant incomplet",
        detail: `${fullName(student)} - ${missingDocumentsText(completion)}`,
        referenceDate: student.updatedAt || student.createdAt || "",
        targetId: student.id,
        action: "student"
      });
    });

  state.enrollments
    .filter(enrollment => !suppressPaymentTrackingForEnrollment(enrollment))
    .forEach(enrollment => {
      const due = makeupDueForEnrollment(enrollment);
      if (due <= 0) return;
      const student = getStudent(enrollment.studentId);
      const course = getCourse(enrollment.courseId);
      const subjects = makeupSubjectsForEnrollment(enrollment);
      notifications.push({
        id: `makeup-${enrollment.id}`,
        type: "makeup",
        severity: due >= MAKEUP_FEE * 2 ? "danger" : "warning",
        title: "Rattrapage à payer",
        detail: `${fullName(student)} - ${course?.name || "-"} - ${subjects.length} matière(s) - ${formatMoney(due)}`,
        referenceDate: subjects.map(subject => {
          const evaluation = state.evaluations.find(item => Number(item.id) === Number(subject.evaluationId));
          return evaluation?.date || "";
        }).filter(Boolean).sort().at(-1) || enrollment.date,
        targetId: enrollment.id,
        reasonKey: MAKEUP_MOTIF_KEY,
        action: "pay"
      });
    });

  const absencesByStudent = new Map();
  (state.attendanceSessions || []).forEach(session => {
    (session.records || []).forEach(record => {
      if (!["absent", "retard"].includes(String(record.status || ""))) return;
      const current = absencesByStudent.get(Number(record.studentId)) || { absent: 0, late: 0, lastDate: "" };
      if (String(record.status) === "absent") current.absent += 1;
      if (String(record.status) === "retard") current.late += 1;
      current.lastDate = [current.lastDate, session.date].filter(Boolean).sort().at(-1) || "";
      absencesByStudent.set(Number(record.studentId), current);
    });
  });
  absencesByStudent.forEach((stats, studentId) => {
    if (stats.absent < 3 && stats.late < 4) return;
    const student = getStudent(studentId);
    notifications.push({
      id: `attendance-${studentId}`,
      type: "attendance",
      severity: stats.absent >= 5 ? "danger" : "warning",
      title: "Présences à surveiller",
      detail: `${fullName(student)} - ${stats.absent} absence(s), ${stats.late} retard(s)`,
      referenceDate: stats.lastDate,
      action: "view",
      view: "attendance"
    });
  });

  (state.onlineRegistrationRequests || [])
    .filter(request => ["nouvelle", "verification", "complement", "dossier-incomplet", "paiement-attendu", "acceptee"].includes(String(request.status || "nouvelle")))
    .forEach(request => {
      const age = daysSince(request.createdAt || request.date || today());
      notifications.push({
        id: `online-${request.id}`,
        type: "online",
        severity: age >= 3 ? "warning" : "info",
        title: "Demande en ligne à traiter",
        detail: `${request.requestNumber || `DEM-${request.id}`} - ${request.lastName || ""} ${request.firstName || ""}`.trim(),
        referenceDate: request.createdAt || request.date || "",
        action: "view",
        view: "onlineRequests"
      });
    });

  (state.groups || [])
    .filter(group => String(group.status || "active") === "active")
    .forEach(group => {
      const remainingDays = daysUntil(group.endDate);
      if (remainingDays < 0 || remainingDays > 30) return;
      const course = getCourse(group.courseId);
      notifications.push({
        id: `group-end-${group.id}`,
        type: "group",
        severity: remainingDays <= 7 ? "warning" : "info",
        title: "Promotion bientôt terminée",
        detail: `${group.name} - ${course?.name || "-"} - fin dans ${remainingDays} jour(s)`,
        referenceDate: group.endDate,
        action: "view",
        view: "groups"
      });
    });

  return notifications.sort((a, b) =>
    notificationSeverityRank(a.severity) - notificationSeverityRank(b.severity) ||
    String(b.referenceDate || "").localeCompare(String(a.referenceDate || "")) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

function renderNotificationBadge() {
  if (!ids.notificationNavCount) return;
  const count = centralNotifications().filter(item => ["danger", "warning"].includes(item.severity)).length;
  ids.notificationNavCount.textContent = count > 99 ? "99+" : String(count);
  ids.notificationNavCount.hidden = count === 0;
}

function renderNotifications() {
  const notifications = centralNotifications();
  const severityFilter = document.getElementById("notificationSeverityFilter")?.value || "";
  const typeFilter = document.getElementById("notificationTypeFilter")?.value || "";
  const visible = notifications.filter(notification =>
    (!severityFilter || notification.severity === severityFilter) &&
    (!typeFilter || notification.type === typeFilter)
  );
  const urgent = notifications.filter(item => item.severity === "danger").length;
  const warning = notifications.filter(item => item.severity === "warning").length;
  const info = notifications.filter(item => item.severity === "info").length;

  if (ids.notificationSummary) {
    ids.notificationSummary.innerHTML = [
      { label: "Urgentes", value: urgent, tone: "red" },
      { label: "À suivre", value: warning, tone: "orange" },
      { label: "Informations", value: info, tone: "blue" },
      { label: "Total", value: notifications.length, tone: "green" }
    ].map(item => `
      <article class="stat-card tone-${item.tone}">
        <span>${escapeHtml(item.label)}</span>
        <strong>${item.value}</strong>
      </article>
    `).join("");
  }

  if (ids.notificationCount) {
    ids.notificationCount.textContent = `${visible.length} notification(s)`;
  }
  if (ids.notificationsTable) {
    ids.notificationsTable.innerHTML = visible.map(notification => `
      <tr>
        <td><span class="alert-pill ${notification.severity}">${escapeHtml(notificationSeverityLabel(notification.severity))}</span></td>
        <td>${escapeHtml(notificationTypeLabel(notification.type))}</td>
        <td>
          <strong>${escapeHtml(notification.title)}</strong>
          <div class="muted">${escapeHtml(notification.detail)}</div>
        </td>
        <td>${notification.referenceDate ? formatDate(notification.referenceDate) : "-"}</td>
        <td>${notificationActionHtml(notification)}</td>
      </tr>
    `).join("") || emptyRow(5, "Aucune notification");
  }
}

function planningTypeLabel(type) {
  return {
    cours: "Cours",
    examen: "Examen",
    rattrapage: "Rattrapage",
    paiement: "Paiement",
    reunion: "Réunion",
    autre: "Autre",
    debut: "Début",
    fin: "Fin"
  }[type] || "Autre";
}

function planningEventSourceLabel(source) {
  return source === "manual" ? "Manuel" : "Automatique";
}

function planningEventDateValue(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function groupPlanningMeta(groupId, trainerId = 0, roomId = 0) {
  const group = getGroup(groupId);
  const trainer = getTrainer(trainerId || group?.trainerId);
  const room = getRoom(roomId || group?.roomId);
  return {
    group,
    trainer,
    room,
    label: [
      group?.name || "",
      group ? groupSessionLabel(group) : "",
      trainerName(trainer),
      room?.name || ""
    ].filter(Boolean).join(" - ") || "-"
  };
}

function automaticPlanningEvents() {
  const events = [];

  (state.groups || []).forEach(group => {
    const course = getCourse(group.courseId);
    const meta = groupPlanningMeta(group.id, group.trainerId);
    if (planningEventDateValue(group.startDate)) {
      events.push({
        id: `group-start-${group.id}`,
        source: "auto",
        type: "cours",
        date: planningEventDateValue(group.startDate),
        time: "",
        title: `Début formation : ${group.name}`,
        detail: course?.name || "",
        groupId: group.id,
        trainerId: group.trainerId || 0,
        meta: meta.label,
        actionView: "groups"
      });
    }
    if (planningEventDateValue(group.endDate)) {
      events.push({
        id: `group-end-${group.id}`,
        source: "auto",
        type: "fin",
        date: planningEventDateValue(group.endDate),
        time: "",
        title: `Fin prévue : ${group.name}`,
        detail: course?.name || "",
        groupId: group.id,
        trainerId: group.trainerId || 0,
        meta: meta.label,
        actionView: "groups"
      });
    }
  });

  (state.evaluations || []).forEach(evaluation => {
    if (!planningEventDateValue(evaluation.date)) return;
    const meta = groupPlanningMeta(evaluation.groupId, evaluation.trainerId);
    events.push({
      id: `evaluation-${evaluation.id}`,
      source: "auto",
      type: evaluation.type === "rattrapage" ? "rattrapage" : "examen",
      date: planningEventDateValue(evaluation.date),
      time: "",
      title: evaluation.title || "Évaluation",
      detail: `${planningTypeLabel(evaluation.type || "examen")} - note / ${evaluation.maxScore || 20}`,
      groupId: evaluation.groupId,
      trainerId: evaluation.trainerId || 0,
      meta: meta.label,
      actionView: "grades"
    });
  });

  monthlyScheduleRows()
    .filter(row => Number(row.balance || 0) > 0)
    .forEach((row, index) => {
      events.push({
        id: `payment-schedule-${index}-${row.month}-${row.student}`,
        source: "auto",
        type: "paiement",
        date: `${row.month}-05`,
        time: "",
        title: "Échéance scolarité",
        detail: `${row.student} - ${row.course} - reste ${formatMoney(row.balance)}`,
        meta: row.course,
        actionView: "reports"
      });
    });

  state.enrollments
    .filter(enrollment => !suppressPaymentTrackingForEnrollment(enrollment))
    .forEach(enrollment => {
      const due = makeupDueForEnrollment(enrollment);
      if (due <= 0) return;
      const student = getStudent(enrollment.studentId);
      const course = getCourse(enrollment.courseId);
      const subjects = makeupSubjectsForEnrollment(enrollment);
      const referenceDate = subjects.map(subject => {
        const evaluation = state.evaluations.find(item => Number(item.id) === Number(subject.evaluationId));
        return planningEventDateValue(evaluation?.date);
      }).filter(Boolean).sort().at(-1) || today();
      events.push({
        id: `makeup-due-${enrollment.id}`,
        source: "auto",
        type: "rattrapage",
        date: referenceDate,
        time: "",
        title: "Rattrapage à programmer",
        detail: `${fullName(student)} - ${course?.name || "-"} - ${subjects.length} matière(s), ${formatMoney(due)}`,
        groupId: enrollment.groupId,
        meta: groupPlanningMeta(enrollment.groupId).label,
        actionView: "payments"
      });
    });

  return events;
}

function planningEvents() {
  const manualEvents = (state.planningEvents || []).map(event => {
    const meta = groupPlanningMeta(event.groupId, event.trainerId, event.roomId);
    return {
      ...event,
      id: `manual-${event.id}`,
      rawId: event.id,
      source: "manual",
      type: event.type || "autre",
      date: planningEventDateValue(event.date),
      time: event.time || "",
      detail: event.note || "",
      meta: meta.label,
      actionView: ""
    };
  });
  return [...manualEvents, ...automaticPlanningEvents()]
    .filter(event => planningEventDateValue(event.date))
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.time || "").localeCompare(String(b.time || "")) ||
      String(a.title || "").localeCompare(String(b.title || ""))
    );
}

function renderPlanning() {
  const from = document.getElementById("planningFromFilter")?.value || "";
  const to = document.getElementById("planningToFilter")?.value || "";
  const type = document.getElementById("planningTypeFilter")?.value || "";
  const allEvents = planningEvents();
  const visible = allEvents.filter(event =>
    (!from || event.date >= from) &&
    (!to || event.date <= to) &&
    (!type || event.type === type)
  );
  const upcoming = allEvents.filter(event => event.date >= today() && daysUntil(event.date) <= 7).length;
  const exams = allEvents.filter(event => event.type === "examen").length;
  const payments = allEvents.filter(event => event.type === "paiement").length;

  if (ids.planningSummary) {
    ids.planningSummary.innerHTML = [
      { label: "À venir 7 jours", value: upcoming, tone: "orange" },
      { label: "Examens", value: exams, tone: "blue" },
      { label: "Échéances", value: payments, tone: "green" },
      { label: "Total planning", value: allEvents.length, tone: "indigo" }
    ].map(item => `
      <article class="stat-card tone-${item.tone}">
        <span>${escapeHtml(item.label)}</span>
        <strong>${item.value}</strong>
      </article>
    `).join("");
  }

  if (ids.planningCount) {
    ids.planningCount.textContent = `${visible.length} événement(s)`;
  }
  if (ids.planningTable) {
    ids.planningTable.innerHTML = visible.map(event => `
      <tr>
        <td>
          <strong>${formatDate(event.date)}</strong>
          ${event.time ? `<div class="muted">${escapeHtml(event.time)}</div>` : ""}
        </td>
        <td>
          <span class="alert-pill ${event.type === "paiement" ? "warning" : event.type === "rattrapage" ? "danger" : "info"}">${escapeHtml(planningTypeLabel(event.type))}</span>
          <div class="muted">${escapeHtml(planningEventSourceLabel(event.source))}</div>
        </td>
        <td>
          <strong>${escapeHtml(event.title || "-")}</strong>
          <div class="muted">${escapeHtml(event.detail || "")}</div>
        </td>
        <td>${escapeHtml(event.meta || "-")}</td>
        <td>
          ${event.source === "manual"
            ? `<div class="actions">
                <button class="chip-button" type="button" data-action="edit-planning-event" data-id="${event.rawId}">Modifier</button>
                <button class="chip-button danger" type="button" data-action="delete-planning-event" data-id="${event.rawId}">Supprimer</button>
              </div>`
            : `<button class="chip-button" type="button" data-action="go-view" data-view="${escapeHtml(event.actionView || "dashboard")}">Ouvrir</button>`}
        </td>
      </tr>
    `).join("") || emptyRow(5, "Aucun événement");
  }
}

function resetPlanningEventForm() {
  const form = document.getElementById("planningEventForm");
  if (!form) return;
  form.reset();
  document.getElementById("planningEventId").value = "";
  document.getElementById("planningEventDate").value = today();
  document.getElementById("planningEventCancelEdit").hidden = true;
}

function savePlanningEvent(event) {
  event.preventDefault();
  const id = Number(document.getElementById("planningEventId").value || 0);
  const payload = {
    date: document.getElementById("planningEventDate").value,
    time: document.getElementById("planningEventTime").value,
    type: document.getElementById("planningEventType").value,
    title: document.getElementById("planningEventTitle").value.trim(),
    groupId: Number(document.getElementById("planningEventGroup").value || 0),
    trainerId: Number(document.getElementById("planningEventTrainer").value || 0),
    roomId: Number(document.getElementById("planningEventRoom").value || 0),
    note: document.getElementById("planningEventNote").value.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentOperatorName()
  };
  if (!payload.date || !payload.title) {
    showToast("Date et titre obligatoires");
    return;
  }
  if (id) {
    const existing = state.planningEvents.find(item => Number(item.id) === id);
    if (existing) Object.assign(existing, payload);
  } else {
    state.planningEvents.push({
      id: nextId(state.planningEvents),
      ...payload,
      createdAt: new Date().toISOString(),
      createdBy: currentOperatorName()
    });
  }
  saveState();
  resetPlanningEventForm();
  render();
  showToast("Événement planning enregistré");
}

function editPlanningEvent(id) {
  const event = state.planningEvents.find(item => Number(item.id) === Number(id));
  if (!event) return;
  setView("planning");
  document.getElementById("planningEventId").value = event.id;
  document.getElementById("planningEventDate").value = planningEventDateValue(event.date) || today();
  document.getElementById("planningEventTime").value = event.time || "";
  document.getElementById("planningEventType").value = event.type || "autre";
  document.getElementById("planningEventTitle").value = event.title || "";
  document.getElementById("planningEventGroup").value = event.groupId || "";
  document.getElementById("planningEventTrainer").value = event.trainerId || "";
  document.getElementById("planningEventRoom").value = event.roomId || "";
  document.getElementById("planningEventNote").value = event.note || "";
  document.getElementById("planningEventCancelEdit").hidden = false;
}

function deletePlanningEvent(id) {
  const event = state.planningEvents.find(item => Number(item.id) === Number(id));
  if (!event) return;
  if (!confirm(`Supprimer l'événement "${event.title || "Planning"}" ?`)) return;
  state.planningEvents = state.planningEvents.filter(item => Number(item.id) !== Number(id));
  saveState();
  render();
  showToast("Événement planning supprimé");
}

function announcementAudienceLabel(value, groupId = 0) {
  const labels = {
    all: "Tout le monde",
    students: "Étudiants",
    staff: "Personnel",
    trainers: "Formateurs",
    group: "Promotion"
  };
  if (value === "group") {
    const group = getGroup(groupId);
    return group ? `Promotion : ${group.name}` : "Promotion";
  }
  return labels[value] || "Tout le monde";
}

function announcementStatusLabel(value) {
  return {
    published: "Publié",
    draft: "Brouillon",
    archived: "Archivé"
  }[value] || "Publié";
}

function roomStatusLabel(value) {
  return {
    available: "Disponible",
    occupied: "Occupée",
    maintenance: "Maintenance",
    inactive: "Inactive"
  }[value] || "Disponible";
}

function equipmentConditionLabel(value) {
  return {
    good: "Bon",
    repair: "À réparer",
    missing: "Manquant",
    retired: "Retiré"
  }[value] || "Bon";
}

function renderAnnouncements() {
  const audienceFilter = document.getElementById("announcementAudienceFilter")?.value || "";
  const statusFilter = document.getElementById("announcementStatusFilter")?.value || "";
  const announcements = [...(state.announcements || [])]
    .filter(item => (!audienceFilter || item.audience === audienceFilter) && (!statusFilter || item.status === statusFilter))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (ids.announcementCount) ids.announcementCount.textContent = `${announcements.length} annonce(s)`;
  if (!ids.announcementsTable) return;
  ids.announcementsTable.innerHTML = announcements.map(item => `
    <tr>
      <td>
        <strong>${formatDate(item.date)}</strong>
        ${item.expiryDate ? `<div class="muted">Expire le ${formatDate(item.expiryDate)}</div>` : ""}
      </td>
      <td>
        <span class="alert-pill ${item.priority || "info"}">${escapeHtml(notificationSeverityLabel(item.priority || "info"))}</span>
        <strong>${escapeHtml(item.title || "-")}</strong>
        <div class="muted">${escapeHtml(item.message || "")}</div>
      </td>
      <td>${escapeHtml(announcementAudienceLabel(item.audience, item.groupId))}</td>
      <td><span class="status ${statusClass(item.status)}">${escapeHtml(announcementStatusLabel(item.status))}</span></td>
      <td>
        <div class="actions">
          <button class="chip-button" type="button" data-action="edit-announcement" data-id="${item.id}">Modifier</button>
          <button class="chip-button danger" type="button" data-action="delete-announcement" data-id="${item.id}">Supprimer</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(5, "Aucune annonce");
}

function resetAnnouncementForm() {
  const form = document.getElementById("announcementForm");
  if (!form) return;
  form.reset();
  document.getElementById("announcementId").value = "";
  document.getElementById("announcementDate").value = today();
  document.getElementById("announcementCancelEdit").hidden = true;
}

function saveAnnouncement(event) {
  event.preventDefault();
  const id = Number(document.getElementById("announcementId").value || 0);
  const payload = {
    title: document.getElementById("announcementTitle").value.trim(),
    priority: document.getElementById("announcementPriority").value,
    audience: document.getElementById("announcementAudience").value,
    groupId: Number(document.getElementById("announcementGroup").value || 0),
    date: document.getElementById("announcementDate").value,
    expiryDate: document.getElementById("announcementExpiry").value,
    status: document.getElementById("announcementStatus").value,
    message: document.getElementById("announcementMessage").value.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentOperatorName()
  };
  if (!payload.title || !payload.date || !payload.message) {
    showToast("Titre, date et message obligatoires");
    return;
  }
  if (payload.audience !== "group") payload.groupId = 0;
  if (id) {
    const existing = state.announcements.find(item => Number(item.id) === id);
    if (existing) Object.assign(existing, payload);
  } else {
    state.announcements.push({
      id: nextId(state.announcements),
      ...payload,
      createdAt: new Date().toISOString(),
      createdBy: currentOperatorName()
    });
  }
  saveState();
  resetAnnouncementForm();
  render();
  showToast("Annonce enregistrée");
}

function editAnnouncement(id) {
  const item = state.announcements.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  setView("announcements");
  document.getElementById("announcementId").value = item.id;
  document.getElementById("announcementTitle").value = item.title || "";
  document.getElementById("announcementPriority").value = item.priority || "info";
  document.getElementById("announcementAudience").value = item.audience || "all";
  document.getElementById("announcementGroup").value = item.groupId || "";
  document.getElementById("announcementDate").value = item.date || today();
  document.getElementById("announcementExpiry").value = item.expiryDate || "";
  document.getElementById("announcementStatus").value = item.status || "published";
  document.getElementById("announcementMessage").value = item.message || "";
  document.getElementById("announcementCancelEdit").hidden = false;
}

function deleteAnnouncement(id) {
  const item = state.announcements.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  if (!confirm(`Supprimer l'annonce "${item.title || "Annonce"}" ?`)) return;
  state.announcements = state.announcements.filter(entry => Number(entry.id) !== Number(id));
  saveState();
  render();
  showToast("Annonce supprimée");
}

function renderResources() {
  const rooms = state.rooms || [];
  const equipment = state.equipment || [];
  if (ids.roomCount) ids.roomCount.textContent = `${rooms.length} salle(s)`;
  if (ids.equipmentCount) ids.equipmentCount.textContent = `${equipment.length} matériel(s)`;

  if (ids.roomsTable) {
    ids.roomsTable.innerHTML = rooms.map(room => `
      <tr>
        <td>
          <strong>${escapeHtml(room.name || "-")}</strong>
          <div class="muted">${escapeHtml(room.location || room.note || "")}</div>
        </td>
        <td>${Number(room.capacity || 0)}</td>
        <td><span class="status ${statusClass(room.status)}">${escapeHtml(roomStatusLabel(room.status))}</span></td>
        <td>
          <div class="actions">
            <button class="chip-button" type="button" data-action="edit-room" data-id="${room.id}">Modifier</button>
            <button class="chip-button danger" type="button" data-action="delete-room" data-id="${room.id}">Supprimer</button>
          </div>
        </td>
      </tr>
    `).join("") || emptyRow(4, "Aucune salle");
  }

  if (ids.equipmentTable) {
    ids.equipmentTable.innerHTML = equipment.map(item => {
      const room = getRoom(item.roomId);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name || "-")}</strong>
            <div class="muted">${escapeHtml(item.type || item.note || "")}</div>
          </td>
          <td>${escapeHtml(room?.name || "-")}</td>
          <td>${Number(item.quantity || 1)}</td>
          <td><span class="status ${statusClass(item.condition)}">${escapeHtml(equipmentConditionLabel(item.condition))}</span></td>
          <td>
            <div class="actions">
              <button class="chip-button" type="button" data-action="edit-equipment" data-id="${item.id}">Modifier</button>
              <button class="chip-button danger" type="button" data-action="delete-equipment" data-id="${item.id}">Supprimer</button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || emptyRow(5, "Aucun matériel");
  }
}

function resetRoomForm() {
  const form = document.getElementById("roomForm");
  if (!form) return;
  form.reset();
  document.getElementById("roomId").value = "";
  document.getElementById("roomCancelEdit").hidden = true;
}

function saveRoom(event) {
  event.preventDefault();
  const id = Number(document.getElementById("roomId").value || 0);
  const payload = {
    name: document.getElementById("roomName").value.trim(),
    capacity: Number(document.getElementById("roomCapacity").value || 0),
    location: document.getElementById("roomLocation").value.trim(),
    status: document.getElementById("roomStatus").value,
    note: document.getElementById("roomNote").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (!payload.name) {
    showToast("Nom de la salle obligatoire");
    return;
  }
  if (id) {
    const existing = state.rooms.find(room => Number(room.id) === id);
    if (existing) Object.assign(existing, payload);
  } else {
    state.rooms.push({ id: nextId(state.rooms), ...payload, createdAt: new Date().toISOString() });
  }
  saveState();
  resetRoomForm();
  render();
  showToast("Salle enregistrée");
}

function editRoom(id) {
  const room = state.rooms.find(item => Number(item.id) === Number(id));
  if (!room) return;
  setView("resources");
  document.getElementById("roomId").value = room.id;
  document.getElementById("roomName").value = room.name || "";
  document.getElementById("roomCapacity").value = room.capacity || "";
  document.getElementById("roomLocation").value = room.location || "";
  document.getElementById("roomStatus").value = room.status || "available";
  document.getElementById("roomNote").value = room.note || "";
  document.getElementById("roomCancelEdit").hidden = false;
}

function deleteRoom(id) {
  const room = state.rooms.find(item => Number(item.id) === Number(id));
  if (!room) return;
  const linkedEquipment = state.equipment.filter(item => Number(item.roomId) === Number(id)).length;
  const message = linkedEquipment
    ? `Supprimer la salle "${room.name}" ? ${linkedEquipment} matériel(s) seront détachés.`
    : `Supprimer la salle "${room.name}" ?`;
  if (!confirm(message)) return;
  state.rooms = state.rooms.filter(item => Number(item.id) !== Number(id));
  state.equipment.forEach(item => {
    if (Number(item.roomId) === Number(id)) item.roomId = 0;
  });
  saveState();
  render();
  showToast("Salle supprimée");
}

function resetEquipmentForm() {
  const form = document.getElementById("equipmentForm");
  if (!form) return;
  form.reset();
  document.getElementById("equipmentId").value = "";
  document.getElementById("equipmentQuantity").value = "1";
  document.getElementById("equipmentCancelEdit").hidden = true;
}

function saveEquipment(event) {
  event.preventDefault();
  const id = Number(document.getElementById("equipmentId").value || 0);
  const payload = {
    name: document.getElementById("equipmentName").value.trim(),
    type: document.getElementById("equipmentType").value.trim(),
    roomId: Number(document.getElementById("equipmentRoom").value || 0),
    quantity: Math.max(1, Number(document.getElementById("equipmentQuantity").value || 1)),
    condition: document.getElementById("equipmentCondition").value,
    note: document.getElementById("equipmentNote").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (!payload.name) {
    showToast("Nom du matériel obligatoire");
    return;
  }
  if (id) {
    const existing = state.equipment.find(item => Number(item.id) === id);
    if (existing) Object.assign(existing, payload);
  } else {
    state.equipment.push({ id: nextId(state.equipment), ...payload, createdAt: new Date().toISOString() });
  }
  saveState();
  resetEquipmentForm();
  render();
  showToast("Matériel enregistré");
}

function editEquipment(id) {
  const item = state.equipment.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  setView("resources");
  document.getElementById("equipmentId").value = item.id;
  document.getElementById("equipmentName").value = item.name || "";
  document.getElementById("equipmentType").value = item.type || "";
  document.getElementById("equipmentRoom").value = item.roomId || "";
  document.getElementById("equipmentQuantity").value = item.quantity || 1;
  document.getElementById("equipmentCondition").value = item.condition || "good";
  document.getElementById("equipmentNote").value = item.note || "";
  document.getElementById("equipmentCancelEdit").hidden = false;
}

function deleteEquipment(id) {
  const item = state.equipment.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  if (!confirm(`Supprimer le matériel "${item.name || "Matériel"}" ?`)) return;
  state.equipment = state.equipment.filter(entry => Number(entry.id) !== Number(id));
  saveState();
  render();
  showToast("Matériel supprimé");
}

function emptyRow(colspan, label) {
  return `<tr><td colspan="${colspan}" class="muted">${label}</td></tr>`;
}

function syncSelects() {
  fillSelect("groupCourse", state.courses, course => course.name, "Choisir une formation");
  fillSelect("groupTrainer", activeTrainers(), trainer => trainerName(trainer), "Choisir un formateur");
  fillSelectWithAll("groupCourseFilter", state.courses, course => course.name, "Toutes formations");
  fillSelectWithAll("enrollmentCourseFilter", state.courses, course => course.name, "Toutes formations");
  fillSelectWithAll("enrollmentGroupFilter", state.groups, group => `${group.name} - ${groupSessionLabel(group)}`, "Toutes promotions");
  fillSelectWithAll("studentCourseFilter", state.courses, course => course.name, "Toutes les formations");
  fillSelect("planningEventGroup", state.groups, group => `${group.name} - ${groupSessionLabel(group)}`, "Aucune promotion");
  fillSelect("planningEventTrainer", activeTrainers(), trainer => trainerName(trainer), "Aucun formateur");
  fillSelect("planningEventRoom", state.rooms || [], room => room.name, "Aucune salle");
  fillSelect("announcementGroup", state.groups, group => `${group.name} - ${groupSessionLabel(group)}`, "Aucune promotion");
  fillSelect("equipmentRoom", state.rooms || [], room => room.name, "Aucune salle");
  fillSelect("studentDesiredCourse", state.courses, course => course.name, "Choisir une formation");
  fillSelect("enrollmentStudent", state.students, student => `${fullName(student)} - ${student.matricule}`, "Choisir un étudiant");
  fillSelect("enrollmentCourse", state.courses, course => course.name, "Choisir une formation");
  syncGroupCourseVersions();
  syncEnrollmentCourseVersions();
  syncEnrollmentGroups();
  fillSelect("paymentEnrollment", state.enrollments.filter(enrollment => !suppressPaymentTrackingForEnrollment(enrollment)), enrollmentLabel, "Choisir une inscription / étudiant");
  syncPaymentReasons();
  fillSelect("attendanceGroup", state.groups, group => group.name);
  fillSelect("evaluationGroup", state.groups, group => group.name);
  fillSelect("evaluationTrainer", state.trainers, trainer => trainerName(trainer));
  const payrollOptions = [
    ...state.staffMembers
      .filter(member => member.status !== "archive")
      .map(member => ({ id: payrollBeneficiaryValue("staff", member.id), label: `${staffName(member)} - ${member.role || "Personnel"}` })),
    ...state.trainers
      .filter(trainer => trainer.status !== "archive")
      .map(trainer => ({ id: payrollBeneficiaryValue("trainer", trainer.id), label: `${trainerName(trainer)} - Formateur` }))
  ];
  fillSelect("staffPaymentStaff", payrollOptions, option => option.label);
  fillSelect("individualReportStudent", state.students, student => `${fullName(student)} - ${student.matricule}`);
  fillSelect("documentGeneratorStudent", state.students, student => `${fullName(student)} - ${student.matricule}`);
  fillSelect("documentGeneratorTemplate", activeDocumentTemplates(), template => `${template.title} - ${template.category}`);
  fillSelect("documentGeneratorBeneficiary", payrollOptions, option => option.label);

  document.getElementById("enrollmentDate").value ||= today();
  document.getElementById("paymentDate").value ||= today();
  document.getElementById("cashDate").value ||= today();
  document.getElementById("attendanceDate").value ||= today();
  document.getElementById("trainerAttendanceDate").value ||= today();
  document.getElementById("staffPaymentDate").value ||= today();
  document.getElementById("staffPaymentPeriod").value ||= today().slice(0, 7);
  document.getElementById("evaluationDate").value ||= today();
}

function fillSelect(id, items, labeler, placeholder = "") {
  const select = document.getElementById(id);
  if (!select) return;
  const oldValue = select.value;
  select.innerHTML = `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}` +
    items.map(item => `<option value="${item.id}">${escapeHtml(labeler(item))}</option>`).join("");
  if (items.some(item => String(item.id) === oldValue)) {
    select.value = oldValue;
  } else if (placeholder) {
    select.value = "";
  }
}

function fillSelectWithAll(id, items, labeler, allLabel) {
  const select = document.getElementById(id);
  if (!select) return;
  const oldValue = select.value;
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
    items.map(item => `<option value="${item.id}">${escapeHtml(labeler(item))}</option>`).join("");
  if ([...select.options].some(option => option.value === oldValue)) {
    select.value = oldValue;
  }
}

function syncPaymentReasons() {
  ensurePaymentMotifs();
  const select = document.getElementById("paymentReason");
  const oldValue = select.value;
  const enrollment = getEnrollment(document.getElementById("paymentEnrollment")?.value);
  if (!enrollment) {
    select.innerHTML = `<option value="">Choisissez d'abord une inscription</option>`;
    updatePaymentReasonFields();
    return;
  }
  const editId = Number(document.getElementById("paymentForm")?.dataset.editId || 0);
  const courseMotifs = normalizeEnrollmentCopiedFees(enrollment)
    .filter(fee => fee.active !== false)
    .map(fee => {
      const key = enrollmentFeeKey(fee);
      const paid = feePaidAmount(enrollment.id, fee, editId);
      const balance = feeBalance(enrollment, fee, editId);
      const status = feePaymentStatus(enrollment, fee, editId);
      return {
        key,
        label: `${fee.label} - prévu ${formatMoney(fee.amountFinal ?? fee.amount)} / payé ${formatMoney(paid)} / reste ${formatMoney(balance)} (${status})`,
        amount: Number(fee.amountFinal ?? fee.amount ?? 0),
        category: fee.category,
        disabled: balance <= 0 && key !== oldValue
      };
    });
  const makeupDue = enrollment ? makeupDueForEnrollment(enrollment) : 0;
  const makeupMotif = state.paymentMotifs.find(motif => motif.key === MAKEUP_MOTIF_KEY);
  const makeupItems = makeupMotif
    ? [{
        ...makeupMotif,
        key: MAKEUP_MOTIF_KEY,
        label: makeupDue > 0
          ? `${makeupMotif.label} - reste ${formatMoney(makeupDue)}`
          : `${makeupMotif.label} - aucun reste`,
        amount: makeupDue > 0 ? Math.min(MAKEUP_FEE, makeupDue) : MAKEUP_FEE,
        disabled: makeupDue <= 0 && oldValue !== MAKEUP_MOTIF_KEY
      }]
    : [];
  const motifs = [...courseMotifs, ...makeupItems];
  select.innerHTML = motifs
    .map(motif => `<option value="${escapeHtml(motif.key)}" ${motif.disabled ? "disabled" : ""}>${escapeHtml(motif.label)}</option>`)
    .join("") || `<option value="">Aucun frais disponible</option>`;

  if ([...select.options].some(option => option.value === oldValue)) {
    select.value = oldValue;
  } else {
    const firstEnabled = [...select.options].find(option => !option.disabled && option.value);
    if (firstEnabled) select.value = firstEnabled.value;
  }
  updatePaymentReasonFields();
}

function syncGroupCourseVersions() {
  const course = getCourse(document.getElementById("groupCourse")?.value);
  const versions = course?.versions || [];
  fillSelect("groupCourseVersion", versions, versionLabel, "Choisir une version");
  const select = document.getElementById("groupCourseVersion");
  if (select && !select.value && activeCourseVersion(course)) {
    select.value = String(activeCourseVersion(course).id);
  }
}

function syncEnrollmentCourseVersions() {
  const course = getCourse(document.getElementById("enrollmentCourse")?.value);
  const versions = course?.versions || [];
  fillSelect("enrollmentCourseVersion", versions, versionLabel, "Choisir une version");
  const select = document.getElementById("enrollmentCourseVersion");
  if (select && !select.value && activeCourseVersion(course)) {
    select.value = String(activeCourseVersion(course).id);
  }
}

function syncEnrollmentGroups() {
  const courseId = Number(document.getElementById("enrollmentCourse").value || 0);
  const versionId = String(document.getElementById("enrollmentCourseVersion")?.value || "");
  if (!courseId) {
    fillSelect("enrollmentGroup", [], group => group.name, "Choisir d'abord une formation");
    syncEnrollmentCourseTypeFromGroup();
    return;
  }
  const groups = state.groups.filter(group => Number(group.courseId) === courseId &&
    (!versionId || !group.versionId || String(group.versionId || group.formationVersionId || "") === versionId));
  fillSelect("enrollmentGroup", groups, group => `${group.name} - ${groupSessionLabel(group)}`, "Choisir une promotion");
  syncEnrollmentCourseTypeFromGroup();
}

function syncEnrollmentCourseTypeFromGroup() {
  const group = getGroup(document.getElementById("enrollmentGroup")?.value);
  const typeInput = document.getElementById("enrollmentCourseType");
  if (!typeInput) return;
  typeInput.value = group?.sessionType || typeInput.value || "jour";
  const yearInput = document.getElementById("enrollmentAcademicYear");
  if (yearInput && group?.year && !yearInput.value) {
    yearInput.value = group.year;
  }
}

function updateEvaluationStudents(existingGrades = null) {
  const groupId = Number(document.getElementById("evaluationGroup").value);
  const grades = existingGrades || [];
  const gradeByStudent = new Map(grades.map(grade => [Number(grade.studentId), grade]));
  const students = studentsForGroup(groupId);
  const maxScore = Number(document.getElementById("evaluationMaxScore").value || 20);

  ids.gradeEntryList.innerHTML = students.map(student => {
    const grade = gradeByStudent.get(Number(student.id)) || {};
    const needsMakeup = gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore);
    const decision = gradeStatusLabel(grade.score, maxScore, grade.makeupScore);
    return `
      <div class="grade-entry-row" data-grade-row="${student.id}">
        <div class="student-line">
          <strong>${escapeHtml(fullName(student))}</strong>
          <span>${escapeHtml(student.matricule)}</span>
          <span class="grade-rule ${needsMakeup ? "makeup" : ""}" data-grade-decision="${student.id}">${escapeHtml(decision)}${needsMakeup ? ` - ${formatMoney(MAKEUP_FEE)}` : ""}</span>
        </div>
        <input type="number" min="0" step="0.25" placeholder="Note / ${maxScore}" value="${escapeHtml(grade.score ?? "")}" data-grade-student="${student.id}">
        <input type="number" min="0" step="0.25" placeholder="Rattrapage / ${maxScore}" value="${escapeHtml(grade.makeupScore ?? "")}" data-grade-makeup="${student.id}">
        <input type="text" placeholder="Appréciation" value="${escapeHtml(grade.appreciation || "")}" data-grade-appreciation="${student.id}">
      </div>
    `;
  }).join("") || `<p class="muted">Aucun étudiant inscrit dans cette promotion.</p>`;
  updateGradeDecisionPreviews();
}

function updateGradeDecisionPreviews() {
  const maxScore = Number(document.getElementById("evaluationMaxScore")?.value || 20);
  document.querySelectorAll("[data-grade-row]").forEach(row => {
    const studentId = row.dataset.gradeRow;
    const score = row.querySelector(`[data-grade-student="${CSS.escape(studentId)}"]`)?.value ?? "";
    const makeupScore = row.querySelector(`[data-grade-makeup="${CSS.escape(studentId)}"]`)?.value ?? "";
    const badge = row.querySelector(`[data-grade-decision="${CSS.escape(studentId)}"]`);
    if (!badge) return;
    const needsMakeup = gradeNeedsMakeup(score, maxScore, makeupScore);
    badge.textContent = `${gradeStatusLabel(score, maxScore, makeupScore)}${needsMakeup ? ` - ${formatMoney(MAKEUP_FEE)}` : ""}`;
    badge.classList.toggle("makeup", needsMakeup);
  });
}

function renderGradeStudentSearch() {
  if (!ids.gradeStudentResults) return;
  const query = normalizeSearchText(ids.gradeStudentSearch?.value || "");
  const students = state.students
    .filter(student => {
      const haystack = normalizeSearchText([student.matricule, student.lastName, student.firstName, student.phone].join(" "));
      return query && haystack.includes(query);
    })
    .slice(0, 12);
  ids.gradeStudentResults.innerHTML = students.map(student => `
    <button class="student-result-button ${Number(student.id) === Number(selectedGradeStudentId) ? "selected" : ""}" type="button" data-action="select-grade-student" data-id="${student.id}">
      <strong>${escapeHtml(fullName(student))}</strong>
      <span>${escapeHtml(student.matricule || "-")} · ${escapeHtml(student.phone || "-")}</span>
    </button>
  `).join("") || `<p class="muted">${query ? "Aucun étudiant trouvé." : "Saisissez au moins une information de recherche."}</p>`;
}

function studentGradeEnrollmentLabel(enrollment) {
  const course = getCourse(enrollment.courseId);
  const group = getGroup(enrollment.groupId);
  return `${course?.name || "Formation"} - ${group?.name || "Promotion"} - ${groupSessionLabel(group)}`;
}

function selectGradeStudent(studentId) {
  selectedGradeStudentId = Number(studentId || 0);
  const enrollments = state.enrollments.filter(enrollment => Number(enrollment.studentId) === selectedGradeStudentId);
  fillSelect("studentGradeEnrollment", enrollments, studentGradeEnrollmentLabel, "Choisir une inscription");
  document.getElementById("studentGradeDate").value ||= today();
  document.getElementById("studentGradeMaxScore").value ||= 20;
  document.getElementById("studentGradeCoefficient").value ||= 1;
  renderGradeStudentSearch();
  renderStudentGradeHistory();
  updateStudentGradeDecision();
}

function updateStudentGradeDecision() {
  if (!ids.studentGradeDecision) return;
  const score = document.getElementById("studentGradeScore")?.value ?? "";
  const makeupScore = document.getElementById("studentGradeMakeupScore")?.value ?? "";
  const maxScore = Number(document.getElementById("studentGradeMaxScore")?.value || 20);
  const needsMakeup = gradeNeedsMakeup(score, maxScore, makeupScore);
  ids.studentGradeDecision.textContent = `${gradeStatusLabel(score, maxScore, makeupScore)}${needsMakeup ? ` - rattrapage ${formatMoney(MAKEUP_FEE)}` : ""}`;
  ids.studentGradeDecision.classList.toggle("makeup", needsMakeup);
}

function renderStudentGradeHistory() {
  if (!ids.studentGradeHistoryTable) return;
  const studentId = selectedGradeStudentId;
  if (!studentId) {
    ids.studentGradeHistoryTable.innerHTML = emptyRow(6, "Choisissez un étudiant pour afficher ses notes.");
    return;
  }
  const rows = studentGradeRows(studentId);
  ids.studentGradeHistoryTable.innerHTML = rows.map(row => `
    <tr>
      <td>${formatDate(row.date)}</td>
      <td>
        <strong>${escapeHtml(row.title || "-")}</strong>
        <div class="muted">${escapeHtml(row.type || "-")}</div>
      </td>
      <td>${escapeHtml(row.groupName || "-")}</td>
      <td>
        ${escapeHtml(row.score || "-")}
        ${row.makeupScore !== "" && row.makeupScore !== undefined ? `<div class="muted">Rattrapage : ${escapeHtml(row.makeupScore)} / ${escapeHtml(row.maxScore || 20)}</div>` : ""}
      </td>
      <td><span class="grade-rule ${row.needsMakeup ? "makeup" : ""}">${escapeHtml(row.status || "-")}</span></td>
      <td>${escapeHtml(row.appreciation || "-")}</td>
    </tr>
  `).join("") || emptyRow(6, "Aucune note enregistrée pour cet étudiant.");
}

function enrollmentLabel(enrollment) {
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const balance = balanceForEnrollment(enrollment);
  return `${fullName(student)} - ${course?.name || "-"} - reste scolarité ${formatMoney(balance)}`;
}

function attendanceStatusLabel(status) {
  if (status === "present") return "Présent";
  if (status === "absent") return "Absent";
  if (status === "retard") return "Retard";
  return status || "-";
}

function showLoginChoice() {
  ids.loginChoiceView.hidden = false;
  document.getElementById("loginForm").hidden = true;
  document.getElementById("studentPortalLoginForm").hidden = true;
  ids.loginError.textContent = "";
  ids.studentPortalLoginError.textContent = "";
  hidePasswordResetBox();
}

function showLoginFormPanel(type) {
  ids.loginChoiceView.hidden = true;
  document.getElementById("loginForm").hidden = type !== "personnel";
  document.getElementById("studentPortalLoginForm").hidden = type !== "student";
  ids.loginError.textContent = "";
  ids.studentPortalLoginError.textContent = "";
  hidePasswordResetBox();
  const focusTarget = type === "student" ? "studentPortalMatricule" : "loginEmail";
  window.setTimeout(() => document.getElementById(focusTarget)?.focus(), 60);
}

function showPasswordResetBox() {
  ids.loginError.textContent = "";
  ids.passwordResetMessage.textContent = "";
  const loginValue = document.getElementById("loginEmail").value.trim();
  ids.passwordResetEmail.value = loginValue.includes("@") ? loginValue : "";
  ids.passwordResetBox.hidden = false;
  window.setTimeout(() => ids.passwordResetEmail.focus(), 60);
}

function hidePasswordResetBox() {
  if (!ids.passwordResetBox) return;
  ids.passwordResetBox.hidden = true;
  ids.passwordResetMessage.textContent = "";
}

async function requestPasswordReset() {
  const email = ids.passwordResetEmail.value.trim().toLowerCase();
  ids.passwordResetMessage.textContent = "";
  if (!email) {
    ids.passwordResetMessage.textContent = "Saisissez l'email du compte.";
    return;
  }

  try {
    const result = await apiRequest("/api/password-reset-request", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    ids.passwordResetMessage.textContent = result.message || "Demande envoyée à l'administrateur.";
  } catch (error) {
    ids.passwordResetMessage.textContent = error.message;
  }
}

function showStudentPortal(data) {
  studentPortalData = data;
  currentUser = null;
  stopServerSync();
  stopIdleLogoutTimer();
  hidePasswordChangeModal();
  if (ids.studentPortal) ids.studentPortal.hidden = false;
  document.body.classList.remove("loading", "needs-login");
  document.body.classList.add("student-portal-mode");
  renderStudentPortal(data);
}

function showLoginScreen() {
  studentPortalData = null;
  stopServerSync();
  stopIdleLogoutTimer();
  hidePasswordChangeModal();
  if (ids.publicRegistration) ids.publicRegistration.hidden = true;
  if (ids.studentPortal) ids.studentPortal.hidden = true;
  showLoginChoice();
  document.body.classList.remove("loading", "student-portal-mode", "public-registration-mode");
  document.body.classList.add("needs-login");
}

function showPublicRegistration() {
  stopServerSync();
  stopIdleLogoutTimer();
  hidePasswordChangeModal();
  if (ids.loginScreen) ids.loginScreen.hidden = true;
  if (ids.studentPortal) ids.studentPortal.hidden = true;
  if (ids.publicRegistration) ids.publicRegistration.hidden = false;
  document.body.classList.remove("loading", "needs-login", "student-portal-mode");
  document.body.classList.add("public-registration-mode");
}

function syncOnlineRegistrationGroups() {
  return;
}

async function loadOnlineRegistrationOptions() {
  const result = await apiRequest("/api/online-registration-options");
  onlineRegistrationOptions = {
    courses: Array.isArray(result.courses) ? result.courses : [],
    groups: []
  };
  if (ids.onlineCourse) {
    ids.onlineCourse.innerHTML = `<option value="">Choisir une formation</option>` +
      onlineRegistrationOptions.courses.map(course => (
        `<option value="${course.id}">${escapeHtml(course.name)}${course.code ? ` - ${escapeHtml(course.code)}` : ""}</option>`
      )).join("");
    ids.onlineCourse.value = "";
  }
}

function onlineRegistrationPayload() {
  return {
    lastName: document.getElementById("onlineLastName").value.trim().toUpperCase(),
    firstName: document.getElementById("onlineFirstName").value.trim(),
    gender: document.getElementById("onlineGender").value,
    birthDate: document.getElementById("onlineBirthDate").value,
    birthPlace: document.getElementById("onlineBirthPlace")?.value.trim() || "",
    nationality: document.getElementById("onlineNationality")?.value.trim() || "",
    phone: document.getElementById("onlinePhone").value.trim(),
    email: document.getElementById("onlineEmail").value.trim(),
    address: document.getElementById("onlineAddress").value.trim(),
    district: document.getElementById("onlineDistrict")?.value.trim() || "",
    city: document.getElementById("onlineCity")?.value.trim() || "",
    country: document.getElementById("onlineCountry")?.value.trim() || "",
    studyLevel: document.getElementById("onlineStudyLevel")?.value.trim() || "",
    profession: document.getElementById("onlineProfession")?.value.trim() || "",
    courseId: Number(document.getElementById("onlineCourse").value || 0),
    preferredCourseType: document.getElementById("onlinePreferredCourseType")?.value || "",
    emergencyName: document.getElementById("onlineEmergencyName").value.trim(),
    emergencyPhone: document.getElementById("onlineEmergencyPhone").value.trim(),
    paymentResponsible: document.getElementById("onlinePaymentResponsible")?.value.trim() || "",
    paymentResponsiblePhone: document.getElementById("onlinePaymentResponsiblePhone")?.value.trim() || "",
    source: document.getElementById("onlineSource")?.value || "site-web",
    message: document.getElementById("onlineMessage").value.trim()
  };
}

async function submitOnlineRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  ids.onlineRegistrationError.textContent = "";
  ids.onlineRegistrationSuccess.hidden = true;
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;

  try {
    const payload = onlineRegistrationPayload();
    if (!payload.lastName || !payload.firstName || !payload.phone || !payload.courseId) {
      throw new Error("Nom, prénom, téléphone et formation sont obligatoires.");
    }
    const result = await apiRequest("/api/online-registration", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    ids.onlineRegistrationSuccess.hidden = false;
    ids.onlineRegistrationSuccess.innerHTML = `
      Inscription envoyée avec succès.<br>
      Numero de demande : <strong>${escapeHtml(result.requestNumber || "-")}</strong><br>
      Votre accès étudiant sera activé après validation administrative.
    `;
  } catch (error) {
    ids.onlineRegistrationError.textContent = error.message;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function studentPortalNotifications(data, context = {}) {
  const student = data.student || {};
  const notifications = [
    ...(data.notifications || []).map(item => ({
      type: item.type || "info",
      severity: item.severity || "info",
      title: item.title || "Notification",
      message: item.message || "",
      date: item.createdAt || ""
    })),
    ...(data.announcements || []).map(item => ({
      type: "announcement",
      severity: item.priority || "info",
      title: item.title || "Annonce",
      message: item.message || "",
      date: item.date || item.createdAt || ""
    }))
  ];

  if (context.makeupGrades?.length) {
    notifications.push({
      type: "makeup",
      severity: "danger",
      title: "Rattrapage requis",
      message: `${context.makeupGrades.length} matière(s) non validée(s). Montant restant : ${formatMoney(context.makeupBalance || 0)}.`,
      date: today()
    });
  }

  if (context.balance > 0) {
    notifications.push({
      type: "payment",
      severity: "warning",
      title: "Reste scolarité à payer",
      message: `Votre reste scolarité actuel est de ${formatMoney(context.balance)}.`,
      date: today()
    });
  }

  const completion = student.documentCompletion || { completed: true, missing: [] };
  if (!completion.completed) {
    notifications.push({
      type: "document",
      severity: "warning",
      title: "Documents manquants",
      message: missingDocumentsText(completion),
      date: today()
    });
  }

  return notifications
    .filter(item => item.title || item.message)
    .sort((a, b) => notificationSeverityRank(a.severity) - notificationSeverityRank(b.severity) || String(b.date || "").localeCompare(String(a.date || "")));
}

function renderStudentPortalNotifications(data, context) {
  if (!ids.studentPortalNotifications) return;
  const notifications = studentPortalNotifications(data, context).slice(0, 12);
  ids.studentPortalNotifications.innerHTML = notifications.map(item => `
    <article class="student-notification-card ${escapeHtml(item.severity || "info")}">
      <span class="alert-pill ${escapeHtml(item.severity || "info")}">${escapeHtml(notificationSeverityLabel(item.severity || "info"))}</span>
      <div>
        <strong>${escapeHtml(item.title || "Notification")}</strong>
        <p>${escapeHtml(item.message || "")}</p>
        <small>${item.date ? escapeHtml(formatDate(item.date)) : ""}</small>
      </div>
    </article>
  `).join("") || `<p class="muted">Aucune notification pour le moment.</p>`;
}

function addStudentNotification(studentId, payload = {}) {
  const id = Number(studentId || 0);
  if (!id) return;
  state.notifications = [
    ...(state.notifications || []),
    {
      id: nextId(state.notifications || []),
      audience: "student",
      studentId: id,
      type: payload.type || "info",
      title: payload.title || "Notification",
      message: payload.message || "",
      severity: payload.severity || "info",
      status: "unread",
      createdAt: payload.createdAt || new Date().toISOString(),
      targetId: payload.targetId || 0
    }
  ];
}

function notifyEvaluationGrades(evaluation) {
  if (!evaluation) return;
  const maxScore = Number(evaluation.maxScore || 20);
  (evaluation.grades || []).forEach(grade => {
    const studentId = Number(grade.studentId || 0);
    if (!studentId) return;
    const needsMakeup = gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore);
    addStudentNotification(studentId, {
      type: "grade",
      severity: needsMakeup ? "danger" : "info",
      title: needsMakeup ? "Matière non validée" : "Nouvelle note publiée",
      message: needsMakeup
        ? `${evaluation.title || "Évaluation"} : ${grade.score}/${maxScore}. Rattrapage requis (${formatMoney(MAKEUP_FEE)}).`
        : `${evaluation.title || "Évaluation"} : ${grade.score}/${maxScore}.`,
      targetId: evaluation.id
    });
  });
}

function renderStudentPortal(data = studentPortalData) {
  if (!data || !ids.studentPortal) return;
  const student = data.student || {};
  const enrollments = data.enrollments || [];
  const payments = data.payments || [];
  const grades = data.grades || [];
  const attendance = data.attendance || [];
  const tuitionPaid = enrollments.reduce((sum, enrollment) => sum + Number(enrollment.tuitionPaid || 0), 0);
  const annexPaid = enrollments.reduce((sum, enrollment) => sum + Number(enrollment.annexPaid || 0), 0);
  const balance = enrollments.reduce((sum, enrollment) => sum + Number(enrollment.balance || 0), 0);
  const numericGrades = grades
    .map(row => Number(row.effectiveScore ?? row.score) * 20 / Number(row.maxScore || 20))
    .filter(score => Number.isFinite(score));
  const average = numericGrades.length
    ? `${(numericGrades.reduce((sum, score) => sum + score, 0) / numericGrades.length).toFixed(2)} / 20`
    : "-";
  const makeupGrades = grades.filter(row => row.needsMakeup);
  const makeupTotal = makeupGrades.length * MAKEUP_FEE;
  const makeupPaid = payments
    .filter(payment => isMakeupMotifKey(payment.reasonKey))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const makeupBalance = Math.max(0, makeupTotal - makeupPaid);
  renderStudentPortalNotifications(data, { makeupGrades, makeupBalance, balance });

  ids.studentPortalName.textContent = student.fullName || fullName(student);
  ids.studentPortalMeta.textContent = `${student.matricule || "-"} · ${student.status || "statut non précisé"}`;
  ids.studentPortalSummary.innerHTML = [
    ["Scolarité payée", formatMoney(tuitionPaid)],
    ["Frais annexes payés", formatMoney(annexPaid)],
    ["Reste scolarité", formatMoney(balance)],
    ["Moyenne notes", average],
    ["Matières non validées", String(makeupGrades.length)],
    ["Rattrapage à prévoir", formatMoney(makeupBalance)]
  ].map(([label, value]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");

  const portalCompletion = student.documentCompletion || { completed: true, missing: [] };
  const portalPhoto = normalizeLogoData(student.photoData || "");
  ids.studentPortalInfo.innerHTML = `
    <div class="student-portal-profile">
      <div class="student-portal-photo">
        ${portalPhoto ? `<img src="${escapeHtml(portalPhoto)}" alt="Photo ${escapeHtml(student.fullName || fullName(student))}">` : "Photo"}
      </div>
      <div>
        <strong>${escapeHtml(student.fullName || fullName(student))}</strong>
        <span class="status ${portalCompletion.completed ? "active" : "inactive"}">
          ${portalCompletion.completed ? "Dossier complet" : "Dossier incomplet"}
        </span>
        <p class="missing-documents">${escapeHtml(missingDocumentsText(portalCompletion))}</p>
      </div>
    </div>
    ${[
      ["Matricule", student.matricule || "-"],
      ["Statut", student.status || "-"],
      ["Téléphone", student.phone || "-"],
      ["Email", student.email || "-"],
      ["Adresse", student.address || "-"],
      ["Date de naissance", formatDate(student.birthDate)],
      ["Personne à contacter", student.emergencyName || "-"],
      ["Téléphone personne à contacter", student.emergencyPhone || "-"],
      ["Documents", personDocumentSummary(student)]
    ].map(([label, value]) => `
      <div class="detail-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("")}
  `;

  ids.studentPortalEnrollments.innerHTML = enrollments.map(enrollment => `
    <tr>
      <td>
        <strong>${escapeHtml(enrollment.courseName || "-")}</strong><br>
        <span class="muted">${escapeHtml(enrollment.groupName || enrollment.courseCode || "-")}</span>
      </td>
      <td>${escapeHtml(enrollment.sessionType || "-")}</td>
      <td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td>
      <td>${formatMoney(enrollment.tuitionPaid)}</td>
      <td><strong>${formatMoney(enrollment.balance)}</strong></td>
    </tr>
  `).join("") || `<tr><td colspan="5">Aucune inscription enregistrée.</td></tr>`;

  ids.studentPortalPayments.innerHTML = payments.map(payment => `
    <tr>
      <td>${formatDate(payment.date)}</td>
      <td>${escapeHtml(payment.receiptNumber || "-")}</td>
      <td>
        ${escapeHtml(payment.reason || "-")}<br>
        <span class="muted">${escapeHtml(payment.category || "")}</span>
      </td>
      <td><strong>${formatMoney(payment.amount)}</strong></td>
      <td>${escapeHtml(payment.method || "-")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">Aucun paiement enregistré.</td></tr>`;

  const makeupSubjectsText = makeupGrades
    .map(row => row.title || "Matière sans titre")
    .join(", ");
  const makeupNotice = makeupGrades.length
    ? `<tr class="student-makeup-notice"><td colspan="5">
        <strong>Notification : ${makeupGrades.length} matière(s) non validée(s).</strong>
        Vous devez faire un rattrapage pour : ${escapeHtml(makeupSubjectsText)}.
        Montant restant à prévoir : ${formatMoney(makeupBalance)} (${formatMoney(MAKEUP_FEE)} par matière).
      </td></tr>`
    : "";
  const gradeRows = grades.map(row => `
    <tr>
      <td>${formatDate(row.date)}</td>
      <td>${escapeHtml(row.title || "-")}</td>
      <td>${escapeHtml(row.groupName || "-")}</td>
      <td>
        <strong>${row.score === "" ? "-" : `${escapeHtml(row.score)} / ${escapeHtml(row.maxScore || 20)}`}</strong><br>
        ${row.makeupScore !== "" && row.makeupScore !== undefined ? `<span class="muted">Rattrapage : ${escapeHtml(row.makeupScore)} / ${escapeHtml(row.maxScore || 20)}</span><br>` : ""}
        <span class="grade-rule ${row.needsMakeup ? "makeup" : ""}">${row.needsMakeup ? "Matière non validée" : escapeHtml(row.status || gradeStatusLabel(row.score, row.maxScore || 20, row.makeupScore))}</span>
      </td>
      <td>
        ${escapeHtml(row.needsMakeup ? "Non validé" : (row.appreciation || ""))}
        ${row.needsMakeup ? `<div class="muted">Rattrapage requis : ${formatMoney(MAKEUP_FEE)} pour cette matière.</div>` : ""}
      </td>
    </tr>
  `).join("");
  ids.studentPortalGrades.innerHTML = makeupNotice + gradeRows || `<tr><td colspan="5">Aucune note enregistrée.</td></tr>`;

  ids.studentPortalAttendance.innerHTML = attendance.map(row => `
    <tr>
      <td>${formatDate(row.date)}</td>
      <td>${escapeHtml(row.groupName || "-")}</td>
      <td>${escapeHtml(row.topic || "-")}</td>
      <td><span class="status">${escapeHtml(attendanceStatusLabel(row.status))}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="4">Aucune présence enregistrée.</td></tr>`;
}

async function loginStudentPortal(event) {
  event.preventDefault();
  ids.studentPortalLoginError.textContent = "";
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;

  try {
    if (!SERVER_MODE) {
      throw new Error("L'espace étudiant doit être ouvert avec le serveur local.");
    }
    const data = await apiRequest("/api/student-portal", {
      method: "POST",
      body: JSON.stringify({
        matricule: document.getElementById("studentPortalMatricule").value,
        phone: document.getElementById("studentPortalPhone").value
      })
    });
    showStudentPortal(data);
  } catch (error) {
    ids.studentPortalLoginError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

function logoutStudentPortal() {
  document.getElementById("studentPortalMatricule").value = "";
  document.getElementById("studentPortalPhone").value = "";
  showLoginScreen();
}

async function bootstrap() {
  wireEvents();
  resetStudentForm();
  resetGroupForm();
  resetEnrollmentForm();
  resetPaymentForm();
  resetPlanningEventForm();
  resetAnnouncementForm();
  resetRoomForm();
  resetEquipmentForm();
  resetTrainerForm();
  resetStaffForm();
  resetEvaluationForm();

  if (PUBLIC_REGISTRATION_MODE) {
    try {
      await loadPublicCenterIdentity();
      await loadOnlineRegistrationOptions();
      showPublicRegistration();
    } catch (error) {
      showPublicRegistration();
      if (ids.onlineRegistrationError) {
        ids.onlineRegistrationError.textContent = error.message || "Chargement impossible";
      }
    }
    return;
  }

  if (!SERVER_MODE) {
    document.body.classList.remove("loading", "needs-login");
    render();
    return;
  }

  try {
    if (sessionStorage.getItem(SESSION_RESUME_KEY) !== "1") {
      await apiRequest("/api/logout", { method: "POST" }).catch(() => {});
      await loadPublicCenterIdentity();
      showLoginScreen();
      return;
    }
    const session = await apiRequest("/api/me");
    currentUser = session.user;
    if (!currentUser) {
      await loadPublicCenterIdentity();
      showLoginScreen();
      return;
    }
    await loadServerState();
    startServerSync();
    startIdleLogoutTimer();
    if (ids.studentPortal) ids.studentPortal.hidden = true;
    document.body.classList.remove("loading", "needs-login", "student-portal-mode");
    render();
    enforcePasswordChangeIfNeeded();
  } catch {
    showLoginScreen();
    ids.loginError.textContent = "Serveur indisponible";
  }
}

async function login(event) {
  event.preventDefault();
  ids.loginError.textContent = "";
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  let loginAccepted = false;

  try {
    const result = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: document.getElementById("loginEmail").value,
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
      })
    });
    loginAccepted = true;
    currentUser = result.user;
    sessionStorage.setItem(SESSION_RESUME_KEY, "1");
    await loadServerState();
    startServerSync();
    startIdleLogoutTimer();
    if (ids.studentPortal) ids.studentPortal.hidden = true;
    document.body.classList.remove("loading", "needs-login", "student-portal-mode");
    render();
    enforcePasswordChangeIfNeeded();
    showToast("Connexion réussie");
  } catch (error) {
    ids.loginError.textContent = loginAccepted && error.status === 401
      ? "Connexion acceptee, mais la session n'est pas conservee. Verifiez l'URL utilisee et redemarrez le serveur avec la derniere version."
      : error.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function logout(options = {}) {
  if (SERVER_MODE) {
    stopServerSync();
    stopIdleLogoutTimer();
    sessionStorage.removeItem(SESSION_RESUME_KEY);
    sessionStorage.removeItem(CLEANUP_MODE_KEY);
    await apiRequest("/api/logout", { method: "POST" }).catch(() => {});
    currentUser = null;
    showLoginScreen();
    renderSession();
    if (options.reason === "idle") {
      ids.loginError.textContent = "Session fermée après inactivité. Reconnectez-vous.";
    }
  }
}

function wireEvents() {
  IDLE_ACTIVITY_EVENTS.forEach(eventName => {
    document.addEventListener(eventName, recordIdleActivity, { passive: true });
  });
  document.getElementById("loginForm").addEventListener("submit", login);
  ids.passwordChangeForm?.addEventListener("submit", changeOwnPassword);
  document.getElementById("studentPortalLoginForm").addEventListener("submit", loginStudentPortal);
  ids.onlineRegistrationForm?.addEventListener("submit", submitOnlineRegistration);
  ids.onlineCourse?.addEventListener("change", syncOnlineRegistrationGroups);
  document.getElementById("onlineLastName")?.addEventListener("input", event => {
    event.target.value = event.target.value.toUpperCase();
  });
  document.getElementById("forgotPasswordButton").addEventListener("click", showPasswordResetBox);
  document.getElementById("cancelPasswordReset").addEventListener("click", hidePasswordResetBox);
  document.getElementById("sendPasswordReset").addEventListener("click", requestPasswordReset);
  document.addEventListener("change", event => {
    const toggle = event.target.closest("[data-toggle-password]");
    if (!toggle) return;
    const input = document.querySelector(`[data-user-password="${CSS.escape(toggle.dataset.togglePassword)}"]`);
    if (input) input.type = toggle.checked ? "text" : "password";
  });
  document.querySelectorAll("[data-login-choice]").forEach(button => {
    button.addEventListener("click", () => showLoginFormPanel(button.dataset.loginChoice));
  });
  document.querySelectorAll("[data-login-back]").forEach(button => {
    button.addEventListener("click", showLoginChoice);
  });
  document.getElementById("studentPortalLogout").addEventListener("click", logoutStudentPortal);
  document.getElementById("logoutButton").addEventListener("click", logout);
  ids.printPreviewPrint?.addEventListener("click", printPreviewDocument);
  ids.printPreviewModal?.addEventListener("click", event => {
    if (event.target.closest("[data-action='close-print-preview']")) {
      closePrintPreview();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && ids.printPreviewModal && !ids.printPreviewModal.hidden) {
      closePrintPreview();
    }
  });

  document.querySelectorAll("[data-view-target]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  document.getElementById("backupButton").addEventListener("click", () => {
    saveState({ immediate: true, notify: true });
  });

  const debouncedStudents = debounce(() => renderAndPaginate(renderStudents, ["studentsTable"]));
  const debouncedOnlineRequests = debounce(() => renderAndPaginate(renderOnlineRequests, ["onlineRequestsTable"]));
  const debouncedCourses = debounce(() => renderAndPaginate(renderCourses, ["coursesTable"]));
  const debouncedPayments = debounce(() => renderAndPaginate(renderPayments, ["paymentsTable"]));
  const debouncedTrainers = debounce(() => renderAndPaginate(renderTrainers, ["trainersTable"]));
  const debouncedStaff = debounce(() => renderAndPaginate(renderStaff, ["staffTable", "staffPaymentsTable"]));
  const debouncedGradeStudentSearch = debounce(renderGradeStudentSearch);

  document.getElementById("studentSearch").addEventListener("input", debouncedStudents);
  document.getElementById("studentStatusFilter").addEventListener("change", () => renderAndPaginate(renderStudents, ["studentsTable"]));
  document.getElementById("studentCourseFilter")?.addEventListener("change", () => renderAndPaginate(renderStudents, ["studentsTable"]));
  document.getElementById("studentSourceFilter")?.addEventListener("change", () => renderAndPaginate(renderStudents, ["studentsTable"]));
  document.getElementById("studentLocationFilter")?.addEventListener("input", debouncedStudents);
  document.getElementById("onlineRequestSearch")?.addEventListener("input", debouncedOnlineRequests);
  document.getElementById("onlineRequestStatusFilter")?.addEventListener("change", () => renderAndPaginate(renderOnlineRequests, ["onlineRequestsTable"]));
  document.getElementById("courseSearch")?.addEventListener("input", debouncedCourses);
  document.getElementById("courseStatusFilter")?.addEventListener("change", () => renderAndPaginate(renderCourses, ["coursesTable"]));
  document.getElementById("notificationSeverityFilter")?.addEventListener("change", () => renderAndPaginate(renderNotifications, ["notificationsTable"]));
  document.getElementById("notificationTypeFilter")?.addEventListener("change", () => renderAndPaginate(renderNotifications, ["notificationsTable"]));
  ["planningFromFilter", "planningToFilter", "planningTypeFilter"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => renderAndPaginate(renderPlanning, ["planningTable"]));
  });
  ["announcementAudienceFilter", "announcementStatusFilter"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => renderAndPaginate(renderAnnouncements, ["announcementsTable"]));
  });
  ["groupCourseFilter", "groupSessionFilter", "groupStatusFilter"].forEach(id => document.getElementById(id)?.addEventListener("change", () => renderAndPaginate(renderGroups, ["groupsTable"])));
  ["enrollmentSearch", "enrollmentCourseFilter", "enrollmentGroupFilter", "enrollmentStatusFilter", "enrollmentBalanceFilter", "enrollmentFromFilter", "enrollmentToFilter"].forEach(id => {
    const element = document.getElementById(id);
    element?.addEventListener(id === "enrollmentSearch" ? "input" : "change", id === "enrollmentSearch" ? debounce(() => renderAndPaginate(renderEnrollments, ["enrollmentsTable"])) : () => renderAndPaginate(renderEnrollments, ["enrollmentsTable"]));
  });
  ["paymentSearch", "paymentCategoryFilter", "paymentMethodFilter", "paymentMonthFilter"].forEach(id => {
    const element = document.getElementById(id);
    element?.addEventListener(id === "paymentSearch" ? "input" : "change", id === "paymentSearch" ? debouncedPayments : () => renderAndPaginate(renderPayments, ["paymentsTable"]));
  });
  ["trainerSearch", "trainerStatusFilter"].forEach(id => {
    const element = document.getElementById(id);
    element?.addEventListener(id === "trainerSearch" ? "input" : "change", id === "trainerSearch" ? debouncedTrainers : () => renderAndPaginate(renderTrainers, ["trainersTable"]));
  });
  ["staffSearch", "staffStatusFilter"].forEach(id => {
    const element = document.getElementById(id);
    element?.addEventListener(id === "staffSearch" ? "input" : "change", id === "staffSearch" ? debouncedStaff : () => renderAndPaginate(renderStaff, ["staffTable", "staffPaymentsTable"]));
  });
  ids.gradeStudentSearch?.addEventListener("input", debouncedGradeStudentSearch);
  ids.gradeStudentResults?.addEventListener("click", event => {
    const button = event.target.closest("[data-action='select-grade-student']");
    if (button) selectGradeStudent(button.dataset.id);
  });
  ["studentLastName", "trainerLastName", "staffLastName"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", event => {
      event.target.value = event.target.value.toUpperCase();
    });
  });

  document.getElementById("studentForm").addEventListener("submit", saveStudent);
  document.getElementById("courseForm").addEventListener("submit", saveCourse);
  document.getElementById("groupForm").addEventListener("submit", saveGroup);
  document.getElementById("enrollmentForm").addEventListener("submit", saveEnrollment);
  document.getElementById("paymentForm").addEventListener("submit", savePayment);
  document.getElementById("cashForm").addEventListener("submit", saveCashEntry);
  document.getElementById("planningEventForm")?.addEventListener("submit", savePlanningEvent);
  document.getElementById("announcementForm")?.addEventListener("submit", saveAnnouncement);
  document.getElementById("roomForm")?.addEventListener("submit", saveRoom);
  document.getElementById("equipmentForm")?.addEventListener("submit", saveEquipment);
  document.getElementById("closeCashDay")?.addEventListener("click", closeCashDay);
  document.getElementById("attendanceForm").addEventListener("submit", saveAttendance);
  document.getElementById("trainerAttendanceForm").addEventListener("submit", saveTrainerAttendance);
  document.getElementById("trainerForm").addEventListener("submit", saveTrainer);
  document.getElementById("staffForm").addEventListener("submit", saveStaff);
  document.getElementById("staffPaymentForm").addEventListener("submit", saveStaffPayment);
  document.getElementById("evaluationForm").addEventListener("submit", saveEvaluation);
  document.getElementById("studentGradeForm")?.addEventListener("submit", saveStudentGrade);
  document.getElementById("centerForm").addEventListener("submit", saveCenter);
  ids.securitySettingsForm?.addEventListener("submit", saveSecuritySettings);
  ids.academicYearForm?.addEventListener("submit", saveAcademicSettings);
  document.getElementById("motifSettingsForm").addEventListener("submit", savePaymentMotifs);
  document.getElementById("courseFeesSettingsForm").addEventListener("submit", saveCourseFeesSettings);
  document.getElementById("documentTemplateForm").addEventListener("submit", saveDocumentTemplate);
  document.getElementById("requiredDocumentsForm").addEventListener("submit", saveRequiredDocumentsSettings);
  document.getElementById("userAccessForm").addEventListener("submit", saveUserAccessSettings);

  document.getElementById("studentCancelEdit").addEventListener("click", resetStudentForm);
  document.getElementById("courseCancelEdit").addEventListener("click", resetCourseForm);
  document.getElementById("groupCancelEdit").addEventListener("click", resetGroupForm);
  document.getElementById("enrollmentCancelEdit").addEventListener("click", resetEnrollmentForm);
  document.getElementById("paymentCancelEdit").addEventListener("click", resetPaymentForm);
  document.getElementById("planningEventCancelEdit")?.addEventListener("click", resetPlanningEventForm);
  document.getElementById("announcementCancelEdit")?.addEventListener("click", resetAnnouncementForm);
  document.getElementById("roomCancelEdit")?.addEventListener("click", resetRoomForm);
  document.getElementById("equipmentCancelEdit")?.addEventListener("click", resetEquipmentForm);
  document.getElementById("trainerCancelEdit").addEventListener("click", resetTrainerForm);
  document.getElementById("staffCancelEdit").addEventListener("click", resetStaffForm);
  document.getElementById("evaluationCancelEdit").addEventListener("click", resetEvaluationForm);

  ["student", "trainer", "staff"].forEach(kind => {
    document.getElementById(`${kind}PhotoInput`)?.addEventListener("change", () => importPersonPhoto(kind));
    document.getElementById(`${kind}RemovePhoto`)?.addEventListener("click", () => removePersonPhoto(kind));
    document.getElementById(`${kind}AddDocument`)?.addEventListener("click", () => addPersonDocument(kind));
  });

  document.getElementById("enrollmentCourse").addEventListener("change", () => {
    syncEnrollmentCourseVersions();
    syncEnrollmentGroups();
    applyCourseCostToEnrollment();
    renderEnrollmentFeeSummary();
  });
  document.getElementById("enrollmentCourseVersion")?.addEventListener("change", () => {
    syncEnrollmentGroups();
    applyCourseCostToEnrollment();
    renderEnrollmentFeeSummary();
  });
  document.getElementById("groupCourse")?.addEventListener("change", () => {
    syncGroupCourseVersions();
  });
  document.getElementById("enrollmentGroup")?.addEventListener("change", () => {
    syncEnrollmentCourseTypeFromGroup();
    renderEnrollmentFeeSummary();
  });
  document.getElementById("enrollmentDiscount").addEventListener("input", () => {
    updateEnrollmentFinal();
    renderEnrollmentFeeSummary();
  });
  document.getElementById("enrollmentTotal").addEventListener("input", () => {
    updateEnrollmentFinal();
    renderEnrollmentFeeSummary();
  });
  document.getElementById("studentLastName").addEventListener("input", event => {
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    event.target.value = event.target.value.toUpperCase();
    event.target.setSelectionRange(start, end);
  });
  document.getElementById("paymentEnrollment").addEventListener("change", () => {
    syncPaymentReasons();
    updatePaymentBalance();
    updatePaymentReasonFields();
  });
  document.getElementById("paymentReason").addEventListener("change", updatePaymentReasonFields);
  document.getElementById("attendanceGroup").addEventListener("change", () => renderAndPaginate(renderAttendance, ["attendanceTable"]));
  document.getElementById("evaluationGroup").addEventListener("change", () => updateEvaluationStudents());
  document.getElementById("evaluationMaxScore").addEventListener("input", () => updateEvaluationStudents());
  ids.gradeEntryList?.addEventListener("input", event => {
    if (event.target.matches("[data-grade-student], [data-grade-makeup]")) {
      updateGradeDecisionPreviews();
    }
  });
  ["studentGradeScore", "studentGradeMakeupScore", "studentGradeMaxScore"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updateStudentGradeDecision);
  });
  document.getElementById("documentGeneratorTemplate").addEventListener("change", renderDocumentGenerator);
  document.getElementById("individualReportStudent").addEventListener("change", renderIndividualReport);

  document.body.addEventListener("click", handleActionClick);
  document.body.addEventListener("click", handleTablePaginationClick);

  document.getElementById("exportPaymentsCsv").addEventListener("click", exportPaymentsCsv);
  document.getElementById("exportCashCsv").addEventListener("click", exportCashCsv);
  document.getElementById("exportStudentsCsv").addEventListener("click", exportStudentsCsv);
  document.getElementById("exportAllCsv").addEventListener("click", exportAllCsv);
  document.getElementById("enableCleanupMode").addEventListener("click", enableCleanupMode);
  document.getElementById("printBalances").addEventListener("click", printBalancesReport);
  ids.previewIndividualReportPdf?.addEventListener("click", printIndividualStudentReport);
  document.getElementById("printIndividualReport").addEventListener("click", printIndividualStudentReport);
  document.getElementById("printStudentTranscript").addEventListener("click", () => {
    printStudentTranscript(Number(ids.individualReportStudent.value));
  });
  document.getElementById("printCustomDocument").addEventListener("click", printSelectedDocumentTemplate);
  document.getElementById("addPaymentMotif").addEventListener("click", addPaymentMotif);
  document.getElementById("newDocumentTemplate").addEventListener("click", resetDocumentTemplateForm);
  document.getElementById("documentTemplateCancelEdit").addEventListener("click", resetDocumentTemplateForm);
  document.getElementById("addUserAccess").addEventListener("click", addUserAccess);
  document.getElementById("centerLogo").addEventListener("change", importCenterLogo);
  document.getElementById("removeCenterLogo").addEventListener("click", removeCenterLogo);
  document.getElementById("centerStamp").addEventListener("change", importCenterStamp);
  document.getElementById("removeCenterStamp").addEventListener("click", removeCenterStamp);
  document.getElementById("exportJson").addEventListener("click", exportJson);
  document.getElementById("importJson").addEventListener("change", importJson);
  document.getElementById("resetData").addEventListener("click", resetData);
}

function saveStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const matricule = form.dataset.editId
    ? document.getElementById("studentMatricule").value.trim()
    : generateMatricule(yearFromDate());
  const payload = {
    matricule,
    firstName: document.getElementById("studentFirstName").value.trim(),
    lastName: document.getElementById("studentLastName").value.trim().toUpperCase(),
    gender: document.getElementById("studentGender").value,
    birthDate: document.getElementById("studentBirthDate").value,
    birthPlace: document.getElementById("studentBirthPlace")?.value.trim() || "",
    nationality: document.getElementById("studentNationality")?.value.trim() || "",
    phone: document.getElementById("studentPhone").value.trim(),
    phone2: document.getElementById("studentPhone2")?.value.trim() || "",
    email: document.getElementById("studentEmail").value.trim(),
    address: document.getElementById("studentAddress").value.trim(),
    district: document.getElementById("studentDistrict")?.value.trim() || "",
    city: document.getElementById("studentCity")?.value.trim() || "",
    country: document.getElementById("studentCountry")?.value.trim() || "",
    studyLevel: document.getElementById("studentStudyLevel")?.value.trim() || "",
    profession: document.getElementById("studentProfession")?.value.trim() || "",
    desiredCourseId: Number(document.getElementById("studentDesiredCourse")?.value || 0),
    fatherName: document.getElementById("studentFatherName")?.value.trim() || "",
    fatherPhone: document.getElementById("studentFatherPhone")?.value.trim() || "",
    motherName: document.getElementById("studentMotherName")?.value.trim() || "",
    motherPhone: document.getElementById("studentMotherPhone")?.value.trim() || "",
    emergencyName: document.getElementById("studentEmergencyName").value.trim(),
    emergencyPhone: document.getElementById("studentEmergencyPhone").value.trim(),
    paymentResponsible: document.getElementById("studentPaymentResponsible")?.value.trim() || "",
    paymentResponsiblePhone: document.getElementById("studentPaymentResponsiblePhone")?.value.trim() || "",
    source: document.getElementById("studentSource")?.value || "",
    observation: document.getElementById("studentObservation")?.value.trim() || "",
    documentStatus: document.getElementById("studentDocumentStatus")?.value || "manquant",
    documentObservation: document.getElementById("studentDocumentObservation")?.value.trim() || "",
    status: document.getElementById("studentStatus").value,
    ...personFilesPayload("student")
  };

  if (!payload.lastName || !payload.firstName || !payload.phone) {
    showToast("Nom, prénom et téléphone sont obligatoires");
    (!payload.lastName ? document.getElementById("studentLastName") : !payload.firstName ? document.getElementById("studentFirstName") : document.getElementById("studentPhone")).focus();
    return;
  }
  if (!validEmail(payload.email)) {
    showToast("Email invalide");
    document.getElementById("studentEmail").focus();
    return;
  }
  if (state.students.some(student => Number(student.id) !== Number(form.dataset.editId || 0) && student.matricule === payload.matricule)) {
    showToast("Ce matricule est déjà utilisé");
    document.getElementById("studentMatricule").focus();
    return;
  }
  if (payload.phone && state.students.some(student =>
    Number(student.id) !== Number(form.dataset.editId || 0) &&
    normalizePhone(student.phone) === normalizePhone(payload.phone)
  )) {
    showToast("Ce téléphone est déjà utilisé par un autre étudiant");
    document.getElementById("studentPhone").focus();
    return;
  }
  if (payload.email && state.students.some(student =>
    Number(student.id) !== Number(form.dataset.editId || 0) &&
    String(student.email || "").trim().toLowerCase() === payload.email.toLowerCase()
  )) {
    showToast("Cet email est déjà utilisé par un autre étudiant");
    document.getElementById("studentEmail").focus();
    return;
  }

  const now = new Date().toISOString();

  if (form.dataset.editId) {
    const student = getStudent(form.dataset.editId);
    Object.assign(student, payload, {
      updatedAt: now,
      updatedBy: currentOperatorName()
    });
    showToast("Étudiant modifié");
  } else {
    state.students.push({
      id: nextId(state.students),
      ...payload,
      createdAt: now,
      updatedAt: now,
      createdBy: currentOperatorName(),
      updatedBy: currentOperatorName()
    });
    showToast("Étudiant ajouté");
  }

  saveState();
  resetStudentForm();
  render();
}

function saveCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    code: document.getElementById("courseCode").value.trim(),
    name: document.getElementById("courseName").value.trim(),
    duration: document.getElementById("courseDuration").value.trim(),
    registrationFee: Number(document.getElementById("courseRegistrationFee").value || 0),
    trainingFee: Number(document.getElementById("courseTrainingFee").value || 0),
    monthlyFee: Number(document.getElementById("courseMonthlyFee").value || 0),
    description: document.getElementById("courseDescription").value.trim(),
    status: document.getElementById("courseStatus").value
  };

  if (form.dataset.editId) {
    const course = getCourse(form.dataset.editId);
    Object.assign(course, payload);
    syncCourseBaseFees(course);
    showToast("Formation modifiée");
  } else {
    const course = { id: nextId(state.courses), ...payload, fees: [] };
    syncCourseBaseFees(course);
    state.courses.push(course);
    showToast("Formation ajoutée");
  }

  saveState();
  resetCourseForm();
  render();
}

function saveGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const trainer = getTrainer(document.getElementById("groupTrainer").value);
  const payload = {
    name: document.getElementById("groupName").value.trim(),
    courseId: Number(document.getElementById("groupCourse").value),
    versionId: document.getElementById("groupCourseVersion")?.value || "",
    formationVersionId: document.getElementById("groupCourseVersion")?.value || "",
    year: document.getElementById("groupYear").value.trim(),
    sessionType: document.getElementById("groupSessionType").value,
    trainerId: Number(document.getElementById("groupTrainer").value),
    trainer: trainerName(trainer),
    capacity: Number(document.getElementById("groupCapacity").value || 0),
    startDate: document.getElementById("groupStartDate").value,
    endDate: document.getElementById("groupEndDate").value,
    status: document.getElementById("groupStatus").value
  };

  if (!payload.courseId) {
    showToast("Choisissez une formation");
    document.getElementById("groupCourse").focus();
    return;
  }
  if (!payload.versionId) {
    showToast("Choisissez une version de formation");
    document.getElementById("groupCourseVersion")?.focus();
    return;
  }
  if (!payload.trainerId) {
    showToast("Choisissez un formateur enregistré");
    document.getElementById("groupTrainer").focus();
    return;
  }

  if (form.dataset.editId) {
    const group = getGroup(form.dataset.editId);
    Object.assign(group, payload);
    showToast("Promotion modifiée");
  } else {
    state.groups.push({ id: nextId(state.groups), ...payload });
    showToast("Promotion ajoutée");
  }

  saveState();
  resetGroupForm();
  render();
}

function saveEnrollment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const course = getCourse(document.getElementById("enrollmentCourse").value);
  const group = getGroup(document.getElementById("enrollmentGroup").value);
  const selectedVersion = getCourseVersion(course, document.getElementById("enrollmentCourseVersion")?.value) ||
    getCourseVersion(course, group?.versionId || group?.formationVersionId) ||
    activeCourseVersion(course);
  const feeSummary = courseFeeSummary(course, { versionId: selectedVersion?.id });
  const registrationFee = feeSummary.fees.find(fee => fee.category === "inscription");
  const hasTuitionFee = feeSummary.fees.some(isTuitionFee);
  const totalTuition = hasTuitionFee ? feeSummary.tuition : courseCost(course);
  const discountAmount = Number(document.getElementById("enrollmentDiscount").value || 0);
  const payload = {
    studentId: Number(document.getElementById("enrollmentStudent").value),
    courseId: Number(document.getElementById("enrollmentCourse").value),
    versionId: selectedVersion?.id || "",
    formationVersionId: selectedVersion?.id || "",
    groupId: Number(document.getElementById("enrollmentGroup").value),
    courseType: document.getElementById("enrollmentCourseType")?.value || group?.sessionType || "jour",
    date: document.getElementById("enrollmentDate").value,
    academicYear: document.getElementById("enrollmentAcademicYear")?.value.trim() || group?.year || yearFromDate(document.getElementById("enrollmentDate").value),
    registrationFee: Number(registrationFee?.amount ?? course?.registrationFee ?? 0),
    totalAmount: Number(totalTuition || 0),
    discountAmount,
    finalAmount: Math.max(0, Number(totalTuition || 0) - discountAmount),
    monthlyFee: Number(course?.monthlyFee || 0),
    status: normalizeEnrollmentStatus(document.getElementById("enrollmentStatus").value),
    observation: document.getElementById("enrollmentObservation")?.value.trim() || ""
  };

  if (!payload.studentId) {
    showToast("Choisissez un étudiant");
    document.getElementById("enrollmentStudent").focus();
    return;
  }
  if (!payload.courseId) {
    showToast("Choisissez une formation");
    document.getElementById("enrollmentCourse").focus();
    return;
  }
  if (!payload.versionId) {
    showToast("Choisissez une version de formation");
    document.getElementById("enrollmentCourseVersion")?.focus();
    return;
  }
  if (!payload.groupId) {
    showToast("Choisissez une promotion");
    document.getElementById("enrollmentGroup").focus();
    return;
  }
  if (payload.discountAmount > payload.totalAmount) {
    showToast("La remise ne peut pas dépasser la scolarité totale");
    document.getElementById("enrollmentDiscount").focus();
    return;
  }
  if (payload.finalAmount < 0) {
    showToast("Le montant final ne peut pas être négatif");
    document.getElementById("enrollmentFinal").focus();
    return;
  }
  const duplicate = state.enrollments.some(enrollment =>
    Number(enrollment.id) !== Number(form.dataset.editId || 0) &&
    Number(enrollment.studentId) === payload.studentId &&
    Number(enrollment.courseId) === payload.courseId &&
    Number(enrollment.groupId) === payload.groupId &&
    isActiveEnrollment(enrollment)
  );
  if (duplicate) {
    showToast("Cet étudiant est déjà inscrit dans cette promotion");
    return;
  }

  const now = new Date().toISOString();
  if (form.dataset.editId) {
    const enrollment = getEnrollment(form.dataset.editId);
    const hasPayments = paymentsForEnrollment(enrollment.id).length > 0;
    const changedFeeSource = Number(enrollment.courseId) !== payload.courseId ||
      String(enrollment.versionId || enrollment.formationVersionId || "") !== String(payload.versionId || "");
    if (hasPayments && changedFeeSource) {
      showToast("Impossible de changer la formation ou la version : des paiements existent déjà");
      return;
    }
    const copiedFees = changedFeeSource || !Array.isArray(enrollment.copiedFees) || !enrollment.copiedFees.length
      ? buildEnrollmentCopiedFees({
          enrollmentId: enrollment.id,
          course,
          version: selectedVersion,
          discountAmount: payload.discountAmount
        })
      : updateCopiedFeesDiscount(normalizeEnrollmentCopiedFees(enrollment), payload.discountAmount);
    Object.assign(enrollment, payload, {
      copiedFees,
      enrollmentFees: copiedFees,
      totalScolarite: copiedFees.filter(isTuitionFee).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
      totalFraisAnnexes: copiedFees.filter(fee => !isTuitionFee(fee) && fee.required).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
      updatedAt: now,
      updatedBy: currentOperatorName()
    });
    enrollment.totalGeneral = Number(enrollment.totalScolarite || 0) + Number(enrollment.totalFraisAnnexes || 0);
    const student = getStudent(payload.studentId);
    if (student && ["validee", "en cours"].includes(payload.status) && isStudentConvertibleStatus(student.status)) {
      student.status = "actif";
      student.updatedAt = now;
      student.updatedBy = currentOperatorName();
    }
    showToast("Inscription modifiée");
  } else {
    const enrollmentId = nextId(state.enrollments);
    const copiedFees = buildEnrollmentCopiedFees({
      enrollmentId,
      course,
      version: selectedVersion,
      discountAmount: payload.discountAmount
    });
    const student = getStudent(payload.studentId);
    if (student && !student.matricule) {
      student.matricule = generateMatricule(yearFromDate(payload.date));
    }
    if (student && ["validee", "en cours"].includes(payload.status) && isStudentConvertibleStatus(student.status)) {
      student.status = "actif";
      student.updatedAt = now;
      student.updatedBy = currentOperatorName();
    }
    state.enrollments.push({
      id: enrollmentId,
      ...payload,
      copiedFees,
      enrollmentFees: copiedFees,
      totalScolarite: copiedFees.filter(isTuitionFee).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
      totalFraisAnnexes: copiedFees.filter(fee => !isTuitionFee(fee) && fee.required).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
      totalGeneral: copiedFees.reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
      createdAt: now,
      updatedAt: now,
      createdBy: currentOperatorName(),
      updatedBy: currentOperatorName()
    });
    showToast("Inscription enregistrée");
  }

  saveState();
  resetEnrollmentForm();
  render();
}

function controlledPaymentReason(actionLabel) {
  if (!canControlPayments()) {
    showToast("Seul l'administrateur peut corriger un paiement");
    return "";
  }
  const reason = prompt(`${actionLabel} : indiquez le motif du controle`);
  if (!reason || reason.trim().length < 4) {
    showToast("Motif de controle obligatoire");
    return "";
  }
  return reason.trim();
}

function paymentSnapshot(payment) {
  return JSON.parse(JSON.stringify(payment || {}));
}

function logPaymentControl(action, payment, controlReason, before = null, after = null) {
  state.paymentAuditLog.push({
    id: nextId(state.paymentAuditLog),
    date: new Date().toISOString(),
    action,
    paymentId: payment?.id || before?.id || after?.id || 0,
    receiptNumber: payment?.receiptNumber || before?.receiptNumber || after?.receiptNumber || "",
    operator: currentOperatorName(),
    controlReason,
    before,
    after
  });
}

function allowOverpayment(message) {
  return isAdmin() && confirm(`${message}\n\nAutoriser ce dépassement en tant qu'administrateur ?`);
}

function validatePaymentPayload(payload, editId = 0) {
  if (!payload.enrollmentId || payload.amount <= 0 || !payload.reason) {
    showToast("Paiement incomplet");
    return false;
  }
  const enrollment = getEnrollment(payload.enrollmentId);
  if (!enrollment || suppressPaymentTrackingForEnrollment(enrollment)) {
    showToast("Cette inscription n'est pas ouverte au paiement");
    return false;
  }
  if (isTuitionMotifKey(payload.reasonKey)) {
    const balance = editId
      ? balanceForEnrollmentExcluding(getEnrollment(payload.enrollmentId), editId)
      : balanceForEnrollment(getEnrollment(payload.enrollmentId));
    if (balance <= 0) {
      showToast("La scolarite est deja soldee");
      return false;
    }
    if (payload.amount > balance) {
      if (!allowOverpayment(`Le paiement dépasse le reste de scolarité : ${formatMoney(balance)}.`)) {
        showToast("Le paiement dépasse le reste de scolarité");
        return false;
      }
    }
    return true;
  }

  if (isMakeupMotifKey(payload.reasonKey)) {
    const enrollment = getEnrollment(payload.enrollmentId);
    const due = makeupDueForEnrollment(enrollment, editId);
    if (due <= 0) {
      showToast("Aucun rattrapage à payer pour cet étudiant");
      return false;
    }
    if (payload.amount % MAKEUP_FEE !== 0) {
      showToast(`Le rattrapage se paie par tranche de ${formatMoney(MAKEUP_FEE)}`);
      return false;
    }
    if (payload.amount > due) {
      showToast(`Le paiement dépasse le reste rattrapage : ${formatMoney(due)}`);
      return false;
    }
    return true;
  }

  const enrollmentFee = enrollmentFeeFromKey(payload.reasonKey, payload.enrollmentId);
  if (enrollmentFee) {
    const due = feeBalance(enrollment, enrollmentFee, editId);
    if (due <= 0) {
      showToast("Ce frais est déjà soldé");
      return false;
    }
    if (payload.amount > due) {
      if (!allowOverpayment(`Le paiement dépasse le reste du frais : ${formatMoney(due)}.`)) {
        showToast(`Le paiement dépasse le reste du frais : ${formatMoney(due)}`);
        return false;
      }
    }
    if (enrollmentFee.once) {
      const alreadyPaid = paymentsForEnrollment(payload.enrollmentId)
        .some(payment => Number(payment.id) !== Number(editId) && String(payment.reasonKey || "") === payload.reasonKey);
      if (alreadyPaid) {
        showToast("Ce frais ne peut être payé qu'une seule fois");
        return false;
      }
    }
    return true;
  }

  const courseFee = courseFeeFromKey(payload.reasonKey);
  if (courseFee) {
    const enrollment = getEnrollment(payload.enrollmentId);
    const due = feeBalance(enrollment, courseFee, editId);
    if (due <= 0) {
      showToast("Ce frais est déjà soldé");
      return false;
    }
    if (payload.amount > due) {
      if (!allowOverpayment(`Le paiement dépasse le reste du frais : ${formatMoney(due)}.`)) {
        showToast(`Le paiement dépasse le reste du frais : ${formatMoney(due)}`);
        return false;
      }
    }
    if (courseFee.once) {
      const alreadyPaid = paymentsForEnrollment(payload.enrollmentId)
        .some(payment => Number(payment.id) !== Number(editId) && String(payment.reasonKey || "") === payload.reasonKey);
      if (alreadyPaid) {
        showToast("Ce frais ne peut être payé qu'une seule fois");
        return false;
      }
    }
    return true;
  }

  const alreadyPaid = paymentsForEnrollment(payload.enrollmentId)
    .some(payment => Number(payment.id) !== Number(editId) && String(payment.reasonKey || "") === payload.reasonKey);
  if (alreadyPaid) {
    showToast("Ce frais annexe est deja paye pour cet etudiant");
    return false;
  }
  return true;
}

async function savePayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const editId = Number(form.dataset.editId || 0);
  const enrollmentId = Number(document.getElementById("paymentEnrollment").value);
  const reasonKey = document.getElementById("paymentReason").value;
  const selectedEnrollmentFee = enrollmentFeeFromKey(reasonKey, enrollmentId);
  const selectedMotif = paymentMotifForReason(reasonKey, enrollmentId);
  const reason = selectedMotif?.label || reasonKey;
  const amount = Number(document.getElementById("paymentAmount").value || 0);
  const payload = {
    enrollmentId,
    studentId: getEnrollment(enrollmentId)?.studentId || 0,
    formationId: getEnrollment(enrollmentId)?.courseId || 0,
    groupId: getEnrollment(enrollmentId)?.groupId || 0,
    enrollmentFeeId: selectedEnrollmentFee?.enrollmentFeeId || selectedEnrollmentFee?.id || "",
    category: selectedEnrollmentFee?.category || paymentFeeCategory({ reasonKey, enrollmentId }),
    amount,
    method: document.getElementById("paymentMethod").value,
    reason,
    reasonKey,
    date: document.getElementById("paymentDate").value,
    receivedBy: currentOperatorName()
  };

  if (!validatePaymentPayload(payload, editId)) return;

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  let shouldUnlockButton = true;
  try {
  let paymentToPrint = null;
  let successMessage = "";

  if (editId) {
    const payment = findById(state.payments, editId);
    if (!payment) return;
    if (isTuitionPayment(payment) !== isTuitionMotifKey(payload.reasonKey)) {
      showToast("La categorie du recu ne peut pas etre changee");
      return;
    }
    const controlReason = controlledPaymentReason("Modification du paiement");
    if (!controlReason) return;
    const before = paymentSnapshot(payment);
    Object.assign(payment, payload, {
      correctedAt: new Date().toISOString(),
      correctedBy: currentOperatorName(),
      correctionReason: controlReason
    });
    logPaymentControl("Modification", payment, controlReason, before, paymentSnapshot(payment));
    successMessage = "Paiement modifié et sauvegardé";
  } else {
    const payment = {
      id: nextId(state.payments),
      receiptNumber: nextReceiptNumber(reasonKey),
      ...payload
    };
    state.payments.push(payment);
    addStudentNotification(payload.studentId, {
      type: "payment",
      severity: "info",
      title: "Paiement enregistré",
      message: `${reason} : ${formatMoney(amount)} reçu le ${formatDate(payload.date)}. Reçu ${payment.receiptNumber}.`,
      targetId: payment.id
    });
    paymentToPrint = payment.id;
    successMessage = "Paiement encaissé et sauvegardé";
  }

  const saved = await saveState({ immediate: true });
  if (!saved) return;
  resetPaymentForm();
  render();
  showToast(successMessage);
  if (paymentToPrint) printReceipt(paymentToPrint);
  shouldUnlockButton = false;
  } finally {
    if (shouldUnlockButton && submitButton) submitButton.disabled = false;
  }
}

async function saveCashEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const amount = Number(document.getElementById("cashAmount").value || 0);
  const category = document.getElementById("cashCategory").value.trim();

  if (amount <= 0 || !category) {
    showToast("Opération de caisse incomplète");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  let shouldUnlockButton = true;
  try {
  state.cashEntries.push({
    id: nextId(state.cashEntries),
    type: document.getElementById("cashType").value,
    date: document.getElementById("cashDate").value,
    category,
    amount,
    method: document.getElementById("cashMethod").value,
    description: document.getElementById("cashDescription").value.trim(),
    recordedBy: document.getElementById("roleSelect").value
  });

  const saved = await saveState({ immediate: true });
  if (!saved) return;
  form.reset();
  document.getElementById("cashDate").value = today();
  render();
  showToast("Opération enregistrée et sauvegardée");
  shouldUnlockButton = false;
  } finally {
    if (shouldUnlockButton && submitButton) submitButton.disabled = false;
  }
}

async function closeCashDay() {
  const date = today();
  const openEntries = state.cashEntries.filter(entry => entry.date === date && !entry.closedAt);
  if (!openEntries.length) {
    showToast("Aucune operation manuelle a cloturer aujourd'hui");
    return;
  }
  if (!confirm(`Cloturer ${openEntries.length} operation(s) de caisse du ${formatDate(date)} ?`)) return;
  const now = new Date().toISOString();
  openEntries.forEach(entry => {
    entry.closedAt = now;
    entry.closedBy = currentOperatorName();
  });
  const saved = await saveState({ immediate: true });
  if (!saved) return;
  renderCash();
  showToast("Journee de caisse cloturee");
}

function saveAttendance(event) {
  event.preventDefault();
  const groupId = Number(document.getElementById("attendanceGroup").value);
  const records = [...document.querySelectorAll("[data-attendance-student]")].map(select => ({
    studentId: Number(select.dataset.attendanceStudent),
    status: select.value
  }));

  if (!groupId || !records.length) {
    showToast("Aucun étudiant pour l'appel");
    return;
  }

  const session = {
    id: nextId(state.attendanceSessions),
    groupId,
    date: document.getElementById("attendanceDate").value,
    topic: document.getElementById("attendanceTopic").value.trim(),
    records
  };

  state.attendanceSessions.push(session);
  saveState();
  document.getElementById("attendanceTopic").value = "";
  render();
  showToast("Appel enregistré");
}

function saveTrainerAttendance(event) {
  event.preventDefault();
  const records = [...document.querySelectorAll("[data-attendance-trainer]")].map(select => ({
    trainerId: Number(select.dataset.attendanceTrainer),
    status: select.value
  }));

  if (!records.length) {
    showToast("Aucun professeur pour l'appel");
    return;
  }

  state.trainerAttendanceSessions.push({
    id: nextId(state.trainerAttendanceSessions),
    date: document.getElementById("trainerAttendanceDate").value,
    topic: document.getElementById("trainerAttendanceTopic").value.trim(),
    records
  });

  saveState();
  document.getElementById("trainerAttendanceTopic").value = "";
  render();
  showToast("Appel des professeurs enregistré");
}

function saveTrainer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    firstName: document.getElementById("trainerFirstName").value.trim(),
    lastName: document.getElementById("trainerLastName").value.trim().toUpperCase(),
    phone: document.getElementById("trainerPhone").value.trim(),
    email: document.getElementById("trainerEmail").value.trim(),
    specialty: document.getElementById("trainerSpecialty").value.trim(),
    modules: document.getElementById("trainerModules").value.trim(),
    status: document.getElementById("trainerStatus").value,
    ...personFilesPayload("trainer")
  };

  if (form.dataset.editId) {
    const trainer = getTrainer(form.dataset.editId);
    Object.assign(trainer, payload);
    showToast("Formateur modifie");
  } else {
    state.trainers.push({ id: nextId(state.trainers), ...payload });
    showToast("Formateur ajoute");
  }

  saveState();
  resetTrainerForm();
  render();
}

function saveStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    firstName: document.getElementById("staffFirstName").value.trim(),
    lastName: document.getElementById("staffLastName").value.trim().toUpperCase(),
    role: document.getElementById("staffRole").value.trim(),
    salary: Number(document.getElementById("staffSalary").value || 0),
    phone: document.getElementById("staffPhone").value.trim(),
    email: document.getElementById("staffEmail").value.trim(),
    status: document.getElementById("staffStatus").value,
    ...personFilesPayload("staff")
  };

  if (!payload.firstName || !payload.lastName || !payload.role) {
    showToast("Fiche personnel incomplete");
    return;
  }

  if (form.dataset.editId) {
    const member = getStaffMember(form.dataset.editId);
    if (!member) return;
    Object.assign(member, payload);
    showToast("Personnel modifie");
  } else {
    state.staffMembers.push({ id: nextId(state.staffMembers), ...payload });
    showToast("Personnel ajoute");
  }

  saveState();
  resetStaffForm();
  render();
}

async function saveStaffPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const beneficiary = parsePayrollBeneficiary(document.getElementById("staffPaymentStaff").value);
  const amount = Number(document.getElementById("staffPaymentAmount").value || 0);

  if (!beneficiary.id || amount <= 0) {
    showToast("Paiement personnel incomplet");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  let shouldUnlockButton = true;
  try {
  state.staffPayments.push({
    id: nextId(state.staffPayments),
    staffId: beneficiary.type === "staff" ? beneficiary.id : 0,
    payeeType: beneficiary.type,
    payeeId: beneficiary.id,
    period: document.getElementById("staffPaymentPeriod").value,
    date: document.getElementById("staffPaymentDate").value || today(),
    reason: document.getElementById("staffPaymentReason").value,
    amount,
    method: document.getElementById("staffPaymentMethod").value,
    note: document.getElementById("staffPaymentNote").value.trim(),
    recordedBy: currentUser?.name || document.getElementById("roleSelect")?.value || "Administrateur"
  });

  const saved = await saveState({ immediate: true });
  if (!saved) return;
  form.reset();
  document.getElementById("staffPaymentDate").value = today();
  document.getElementById("staffPaymentPeriod").value = today().slice(0, 7);
  render();
  showToast("Paiement personnel enregistré et sauvegardé");
  shouldUnlockButton = false;
  } finally {
    if (shouldUnlockButton && submitButton) submitButton.disabled = false;
  }
}

function saveEvaluation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const maxScore = Number(document.getElementById("evaluationMaxScore").value || 20);
  const groupId = Number(document.getElementById("evaluationGroup").value);
  const existingEvaluation = form.dataset.editId ? getEvaluation(form.dataset.editId) : null;
  const previousByStudent = new Map((existingEvaluation?.grades || []).map(grade => [Number(grade.studentId), grade]));
  const grades = [...document.querySelectorAll("[data-grade-student]")].map(input => {
    const studentId = Number(input.dataset.gradeStudent);
    const makeupInput = document.querySelector(`[data-grade-makeup="${studentId}"]`);
    const score = input.value === "" ? "" : Number(input.value);
    const makeupScore = makeupInput?.value === "" ? "" : Number(makeupInput?.value || "");
    const previous = previousByStudent.get(studentId) || {};
    const changed = previousByStudent.has(studentId) && (
      String(previous.score ?? "") !== String(score ?? "") ||
      String(previous.makeupScore ?? "") !== String(makeupScore ?? "") ||
      String(previous.appreciation || "") !== String(document.querySelector(`[data-grade-appreciation="${studentId}"]`)?.value.trim() || "")
    );
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    if (changed) {
      history.push({
        at: new Date().toISOString(),
        by: currentOperatorName(),
        score: previous.score ?? "",
        makeupScore: previous.makeupScore ?? "",
        appreciation: previous.appreciation || "",
        decision: previous.decision || gradeStatusLabel(previous.score, maxScore, previous.makeupScore)
      });
    }
    const enrollment = state.enrollments.find(item =>
      Number(item.studentId) === studentId &&
      Number(item.groupId) === groupId &&
      !isInactiveTuitionEnrollment(item)
    );
    const decision = gradeStatusLabel(score, maxScore, makeupScore);
    return {
      id: previous.id || `${form.dataset.editId || "new"}-${studentId}`,
      studentId,
      enrollmentId: enrollment?.id || previous.enrollmentId || 0,
      score,
      makeupScore,
      decision,
      needsMakeup: gradeNeedsMakeup(score, maxScore, makeupScore),
      makeupFee: gradeNeedsMakeup(score, maxScore, makeupScore) ? MAKEUP_FEE : 0,
      appreciation: document.querySelector(`[data-grade-appreciation="${studentId}"]`)?.value.trim() || "",
      updatedAt: new Date().toISOString(),
      updatedBy: currentOperatorName(),
      history
    };
  });

  const invalidGrade = grades.some(grade =>
    (grade.score !== "" && (Number(grade.score) < 0 || Number(grade.score) > maxScore)) ||
    (grade.makeupScore !== "" && (Number(grade.makeupScore) < 0 || Number(grade.makeupScore) > maxScore))
  );
  if (invalidGrade) {
    showToast("Une note depasse le bareme");
    return;
  }

  const payload = {
    groupId,
    trainerId: Number(document.getElementById("evaluationTrainer").value || 0),
    title: document.getElementById("evaluationTitle").value.trim(),
    type: document.getElementById("evaluationType").value,
    date: document.getElementById("evaluationDate").value,
    maxScore,
    grades
  };

  if (!payload.groupId || !payload.title) {
    showToast("Evaluation incomplete");
    return;
  }

  let savedEvaluation = null;
  if (form.dataset.editId) {
    const evaluation = getEvaluation(form.dataset.editId);
    Object.assign(evaluation, payload);
    savedEvaluation = evaluation;
    showToast("Evaluation modifiee");
  } else {
    savedEvaluation = { id: nextId(state.evaluations), ...payload };
    state.evaluations.push(savedEvaluation);
    showToast("Evaluation enregistree");
  }
  notifyEvaluationGrades(savedEvaluation);

  saveState();
  resetEvaluationForm();
  render();
}

function saveStudentGrade(event) {
  event.preventDefault();
  if (!selectedGradeStudentId) {
    showToast("Choisissez d'abord un étudiant");
    ids.gradeStudentSearch?.focus();
    return;
  }
  const enrollment = getEnrollment(document.getElementById("studentGradeEnrollment")?.value);
  if (!enrollment) {
    showToast("Choisissez l'inscription concernée");
    document.getElementById("studentGradeEnrollment")?.focus();
    return;
  }
  const title = document.getElementById("studentGradeTitle")?.value.trim() || "";
  const maxScore = Number(document.getElementById("studentGradeMaxScore")?.value || 20);
  const scoreValue = document.getElementById("studentGradeScore")?.value ?? "";
  const makeupValue = document.getElementById("studentGradeMakeupScore")?.value ?? "";
  const score = scoreValue === "" ? "" : Number(scoreValue);
  const makeupScore = makeupValue === "" ? "" : Number(makeupValue);
  if (!title) {
    showToast("Saisissez le module ou la matière");
    document.getElementById("studentGradeTitle")?.focus();
    return;
  }
  if ((score !== "" && (score < 0 || score > maxScore)) || (makeupScore !== "" && (makeupScore < 0 || makeupScore > maxScore))) {
    showToast("Une note dépasse le barème");
    return;
  }

  const now = new Date().toISOString();
  const type = document.getElementById("studentGradeType")?.value || "devoir";
  const date = document.getElementById("studentGradeDate")?.value || today();
  const groupId = Number(enrollment.groupId || 0);
  const existingEvaluation = state.evaluations.find(evaluation =>
    Number(evaluation.groupId) === groupId &&
    String(evaluation.title || "").toLowerCase() === title.toLowerCase() &&
    String(evaluation.type || "") === type &&
    String(evaluation.date || "") === date
  );
  const existingGrade = existingEvaluation?.grades?.find(grade =>
    Number(grade.studentId) === selectedGradeStudentId &&
    Number(grade.enrollmentId || enrollment.id) === Number(enrollment.id)
  );
  const history = Array.isArray(existingGrade?.history) ? [...existingGrade.history] : [];
  if (existingGrade) {
    history.push({
      at: now,
      by: currentOperatorName(),
      score: existingGrade.score ?? "",
      makeupScore: existingGrade.makeupScore ?? "",
      appreciation: existingGrade.appreciation || "",
      decision: existingGrade.decision || gradeStatusLabel(existingGrade.score, existingEvaluation.maxScore || maxScore, existingGrade.makeupScore)
    });
  }
  const grade = {
    id: existingGrade?.id || `${existingEvaluation?.id || "new"}-${selectedGradeStudentId}-${Date.now()}`,
    studentId: selectedGradeStudentId,
    enrollmentId: enrollment.id,
    formationId: enrollment.courseId,
    formationVersionId: enrollment.versionId || enrollment.formationVersionId || "",
    groupId,
    score,
    makeupScore,
    coefficient: Number(document.getElementById("studentGradeCoefficient")?.value || 1),
    appreciation: document.getElementById("studentGradeAppreciation")?.value.trim() || "",
    decision: gradeStatusLabel(score, maxScore, makeupScore),
    needsMakeup: gradeNeedsMakeup(score, maxScore, makeupScore),
    makeupFee: gradeNeedsMakeup(score, maxScore, makeupScore) ? MAKEUP_FEE : 0,
    createdAt: existingGrade?.createdAt || now,
    updatedAt: now,
    updatedBy: currentOperatorName(),
    history
  };

  if (existingEvaluation) {
    existingEvaluation.maxScore = maxScore;
    existingEvaluation.coefficient = Number(document.getElementById("studentGradeCoefficient")?.value || existingEvaluation.coefficient || 1);
    existingEvaluation.updatedAt = now;
    existingEvaluation.updatedBy = currentOperatorName();
    existingEvaluation.grades = [
      ...(existingEvaluation.grades || []).filter(item => !(Number(item.studentId) === selectedGradeStudentId && Number(item.enrollmentId || enrollment.id) === Number(enrollment.id))),
      grade
    ];
    showToast("Note étudiant modifiée");
    notifyEvaluationGrades({ ...existingEvaluation, grades: [grade] });
  } else {
    const newEvaluation = {
      id: nextId(state.evaluations),
      formationId: enrollment.courseId,
      formationVersionId: enrollment.versionId || enrollment.formationVersionId || "",
      groupId,
      trainerId: 0,
      title,
      type,
      date,
      maxScore,
      coefficient: Number(document.getElementById("studentGradeCoefficient")?.value || 1),
      createdBy: currentOperatorName(),
      createdAt: now,
      updatedBy: currentOperatorName(),
      updatedAt: now,
      grades: [grade]
    };
    state.evaluations.push(newEvaluation);
    notifyEvaluationGrades(newEvaluation);
    showToast("Note étudiant enregistrée");
  }

  saveState();
  document.getElementById("studentGradeTitle").value = "";
  document.getElementById("studentGradeScore").value = "";
  document.getElementById("studentGradeMakeupScore").value = "";
  document.getElementById("studentGradeAppreciation").value = "";
  updateStudentGradeDecision();
  renderEvaluations();
  renderStudentGradeHistory();
}

function saveCenter(event) {
  event.preventDefault();
  state.center = {
    ...(state.center || {}),
    name: document.getElementById("centerName").value.trim() || "CFP EREXIT",
    subtitle: document.getElementById("centerSubtitle").value.trim() || "Centre de Formation Professionnelle",
    phone: document.getElementById("centerPhone").value.trim(),
    email: document.getElementById("centerEmail").value.trim(),
    address: document.getElementById("centerAddress").value.trim(),
    logoData: state.center?.logoData || "",
    stampData: state.center?.stampData || ""
  };
  saveState();
  renderCenterIdentity();
  showToast("Informations du centre enregistrées");
}

function saveSecuritySettings(event) {
  event.preventDefault();
  state.securitySettings = normalizeSecuritySettings({
    idleTimeoutMinutes: ids.idleTimeoutMinutes?.value || 30
  });
  saveState({ immediate: true, notify: true });
  startIdleLogoutTimer();
  renderSecuritySettings();
  showToast("Sécurité mise à jour");
}

function saveAcademicSettings(event) {
  event.preventDefault();
  const activeYear = String(ids.activeAcademicYear?.value || "").trim();
  if (!/^\d{4}$/.test(activeYear)) {
    showToast("L'année active doit contenir 4 chiffres");
    ids.activeAcademicYear?.focus();
    return;
  }
  state.academicSettings = normalizeAcademicSettings({
    activeYear,
    archivedYears: ids.archivedAcademicYears?.value || ""
  });
  saveState({ immediate: true, notify: true });
  render();
  showToast("Archivage annuel mis à jour");
}

async function importCenterLogo(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Format de logo invalide");
    event.target.value = "";
    return;
  }

  try {
    const logoData = file.type === "image/svg+xml"
      ? await svgToDataUrl(file)
      : await imageToPngDataUrl(file);
    state.center = {
      ...(state.center || {}),
      logoData
    };
    saveState();
    render();
    showToast("Logo enregistré");
  } catch {
    showToast("Logo illisible");
  } finally {
    event.target.value = "";
  }
}

function removeCenterLogo() {
  state.center = {
    ...(state.center || {}),
    logoData: ""
  };
  saveState();
  render();
  showToast("Logo retiré");
}

async function importCenterStamp(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Format de signature/cachet invalide");
    event.target.value = "";
    return;
  }

  try {
    const stampData = file.type === "image/svg+xml"
      ? await svgToDataUrl(file)
      : await imageToPngDataUrl(file, 420);
    state.center = {
      ...(state.center || {}),
      stampData
    };
    saveState();
    render();
    showToast("Signature/cachet enregistré");
  } catch {
    showToast("Signature/cachet illisible");
  } finally {
    event.target.value = "";
  }
}

function removeCenterStamp() {
  state.center = {
    ...(state.center || {}),
    stampData: ""
  };
  saveState();
  render();
  showToast("Signature/cachet retiré");
}

function savePaymentMotifs(event) {
  event.preventDefault();
  collectPaymentMotifInputs();
  saveState();
  syncPaymentReasons();
  render();
  showToast("Motifs enregistrés");
}

function courseFeeRowHtml(course, fee, versionKey) {
  return `
    <div class="course-fee-row" data-course-fee-row="${escapeHtml(versionKey)}" data-fee-id="${escapeHtml(fee.id)}">
      <input type="text" value="${escapeHtml(fee.label)}" data-fee-label required>
      <select data-fee-category>
        ${["inscription", "scolarite", "documentation", "equipement", "tenue", "examen", "rattrapage", "certificat", "autre"].map(category => `<option value="${category}" ${fee.category === category ? "selected" : ""}>${feeCategoryLabel(category)}</option>`).join("")}
      </select>
      <input type="number" min="0" step="500" value="${Number(fee.amount || 0)}" data-fee-amount>
      <label class="inline-check"><input type="checkbox" data-fee-required ${fee.required ? "checked" : ""}> Oblig.</label>
      <label class="inline-check"><input type="checkbox" data-fee-once ${fee.once ? "checked" : ""}> 1 fois</label>
      <label class="inline-check"><input type="checkbox" data-fee-included ${fee.includedInTuition ? "checked" : ""}> Scolarité</label>
      <label class="inline-check"><input type="checkbox" data-fee-active ${fee.active ? "checked" : ""}> Actif</label>
      <input type="number" min="1" step="1" value="${Number(fee.order || 1)}" data-fee-order title="Ordre">
      <input type="text" value="${escapeHtml(fee.observation || "")}" data-fee-observation placeholder="Observation">
      <button class="chip-button danger" type="button" data-action="delete-course-fee" data-course-id="${course.id}" data-fee-id="${escapeHtml(fee.id)}">Retirer</button>
    </div>
  `;
}

function settingElementByAttribute(attribute, value) {
  return [...document.querySelectorAll(`[${attribute}]`)]
    .find(element => element.getAttribute(attribute) === String(value));
}

function courseFeeRowsForVersion(versionKey) {
  return [...document.querySelectorAll("[data-course-fee-row]")]
    .filter(row => row.dataset.courseFeeRow === String(versionKey));
}

function collectCourseFeesSettingsDraft() {
  state.courses.forEach(course => {
    ensureCourseVersions(course);
    const version = activeCourseVersion(course) || course.versions[0];
    const versionKey = `${course.id}:${version?.id || ""}`;
    const monthlyInput = document.querySelector(`[data-course-monthly-fee="${course.id}"]`);
    course.monthlyFee = Number(monthlyInput?.value || 0);
    if (version) {
      version.name = settingElementByAttribute("data-version-name", versionKey)?.value.trim() || version.name || "Version";
      version.duration = settingElementByAttribute("data-version-duration", versionKey)?.value.trim() || version.duration || course.duration || "";
      version.year = settingElementByAttribute("data-version-year", versionKey)?.value.trim() || version.year || "";
      version.paymentSchedulePercentages = normalizePaymentSchedulePercentages(
        settingElementByAttribute("data-version-schedule", versionKey)?.value || version.paymentSchedulePercentages
      );
      version.updatedAt = new Date().toISOString();
    }
    const fees = courseFeeRowsForVersion(versionKey)
      .map((row, index) => normalizeCourseFee(course, {
        id: row.dataset.feeId || `${course.id}-${Date.now()}-${index}`,
        label: row.querySelector("[data-fee-label]")?.value.trim(),
        category: row.querySelector("[data-fee-category]")?.value || "autre",
        amount: Number(row.querySelector("[data-fee-amount]")?.value || 0),
        required: !!row.querySelector("[data-fee-required]")?.checked,
        once: !!row.querySelector("[data-fee-once]")?.checked,
        includedInTuition: !!row.querySelector("[data-fee-included]")?.checked,
        active: !!row.querySelector("[data-fee-active]")?.checked,
        order: Number(row.querySelector("[data-fee-order]")?.value || index + 1),
        observation: row.querySelector("[data-fee-observation]")?.value.trim() || ""
      }, index))
      .filter(fee => fee.label && fee.amount >= 0);
    if (version) {
      version.fees = fees;
    }
    course.fees = fees;
    const registration = fees.find(fee => fee.category === "inscription" && fee.active);
    const tuition = fees.find(fee => fee.category === "scolarite" && fee.active);
    course.registrationFee = Number(registration?.amount || 0);
    course.trainingFee = Number(tuition?.amount || 0);
  });
}

function saveCourseFeesSettings(event) {
  event.preventDefault();
  collectCourseFeesSettingsDraft();
  saveState();
  renderCourses();
  syncSelects();
  renderSettings();
  showToast("Frais des formations enregistrés");
}

function addCourseFee(courseId) {
  const course = getCourse(courseId);
  if (!course) return;
  ensureCourseVersions(course);
  const version = activeCourseVersion(course) || course.versions[0];
  const versionKey = `${course.id}:${version?.id || ""}`;
  const list = settingElementByAttribute("data-course-fee-list", versionKey);
  const currentCount = courseFeeRowsForVersion(versionKey).length;
  const fee = {
    id: `${course.id}-${version?.id || "v"}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    courseId: Number(course.id),
    label: "Nouveau frais",
    category: "autre",
    amount: 0,
    required: false,
    once: true,
    includedInTuition: false,
    active: true,
    order: currentCount + 1,
    observation: ""
  };
  if (list) {
    list.querySelector(".muted")?.remove();
    list.insertAdjacentHTML("beforeend", courseFeeRowHtml(course, fee, versionKey));
    list.querySelector(`[data-fee-id="${CSS.escape(fee.id)}"] [data-fee-label]`)?.focus();
  }
  collectCourseFeesSettingsDraft();
}

function deleteCourseFee(courseId, feeId) {
  const course = getCourse(courseId);
  if (!course) return;
  ensureCourseVersions(course);
  const version = activeCourseVersion(course) || course.versions[0];
  const versionKey = `${course.id}:${version?.id || ""}`;
  const row = courseFeeRowsForVersion(versionKey).find(item => String(item.dataset.feeId) === String(feeId));
  collectCourseFeesSettingsDraft();
  const fees = courseFees(course, { activeOnly: false, versionId: version?.id });
  const fee = fees.find(item => String(item.id) === String(feeId));
  if (!fee) return;
  if (state.payments.some(payment => String(payment.reasonKey || "") === courseFeeKey(fee) || String(payment.reasonKey || "") === enrollmentFeeKey(fee))) {
    showToast("Frais déjà utilisé dans un paiement : désactivez-le au lieu de le retirer");
    return;
  }
  row?.remove();
  collectCourseFeesSettingsDraft();
  const list = settingElementByAttribute("data-course-fee-list", versionKey);
  if (list && !courseFeeRowsForVersion(versionKey).length) {
    list.innerHTML = `<p class="muted">Aucun frais configuré.</p>`;
  }
}

function saveUserAccessSettings(event) {
  event.preventDefault();
  if (!isAdmin()) {
    showToast("Accès réservé à l'administrateur");
    return;
  }
  if (!state.users.length) {
    showToast("Liste des utilisateurs non chargee. Rechargez la page.");
    return;
  }

  const users = [...document.querySelectorAll("[data-user-access-row]")].map(row => {
    const idText = row.dataset.userAccessRow;
    const id = Number(idText);
    const existing = state.users.find(user => Number(user.id) === id) || {};
    const roleInput = row.querySelector(`[data-user-role="${CSS.escape(idText)}"]`);
    const role = roleCode(existing.role) === "administrateur" ? "Administrateur" : (roleInput?.value || existing.role || "Secrétaire");
    const permissions = roleCode(role) === "administrateur"
      ? [...ACCESS_VIEWS]
      : [...row.querySelectorAll(`[data-user-permission="${CSS.escape(idText)}"]:checked`)].map(input => input.value);
    const password = row.querySelector(`[data-user-password="${CSS.escape(idText)}"]`)?.value.trim() || "";
    const isNewUser = !existing.email;
    return {
      id,
      name: row.querySelector(`[data-user-name="${CSS.escape(idText)}"]`)?.value.trim() || "Utilisateur",
      username: normalizeUsername(row.querySelector(`[data-user-username="${CSS.escape(idText)}"]`)?.value || existing.username || ""),
      email: row.querySelector(`[data-user-email="${CSS.escape(idText)}"]`)?.value.trim().toLowerCase() || existing.email || "",
      role,
      status: roleCode(role) === "administrateur" ? "active" : (row.querySelector(`[data-user-status="${CSS.escape(idText)}"]`)?.value || "active"),
      permissions,
      isNewUser,
      ...(password ? { password } : {})
    };
  });

  if (users.some(user => !user.email)) {
    showToast("Chaque utilisateur doit avoir un email");
    return;
  }
  if (users.some(user => !user.username)) {
    showToast("Chaque utilisateur doit avoir un identifiant");
    return;
  }
  if (users.some(user => user.isNewUser && !user.password)) {
    showToast("Mot de passe obligatoire pour un nouvel utilisateur");
    return;
  }
  const weakPassword = users.find(user => user.password && !strongPassword(user.password));
  if (weakPassword) {
    showToast("Mot de passe trop faible : 8 caractères, majuscule, minuscule, chiffre et caractère spécial");
    return;
  }
  const uniqueEmails = new Set(users.map(user => user.email));
  if (uniqueEmails.size !== users.length) {
    showToast("Deux utilisateurs ont le même email");
    return;
  }
  const uniqueUsernames = new Set(users.map(user => user.username));
  if (uniqueUsernames.size !== users.length) {
    showToast("Deux utilisateurs ont le même identifiant");
    return;
  }

  const changedPasswordEmails = users
    .filter(user => user.password)
    .map(user => user.email);
  state.users = users.map(({ isNewUser, ...user }) => user);
  if (changedPasswordEmails.length) {
    state.passwordResetRequests = (state.passwordResetRequests || []).map(request => (
      changedPasswordEmails.includes(request.email)
        ? { ...request, status: "done", resolvedAt: new Date().toISOString(), resolvedBy: currentOperatorName() }
        : request
    ));
  }
  saveState();
  renderSettings();
  showToast("Accès utilisateurs enregistrés");
}

function saveRequiredDocumentsSettings(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  state.requiredDocuments = {
    student: linesFromTextarea("student"),
    trainer: linesFromTextarea("trainer"),
    staff: linesFromTextarea("staff")
  };
  saveState();
  render();
  showToast("Documents obligatoires enregistrés");
}

function linesFromTextarea(kind) {
  const value = document.querySelector(`[data-required-documents="${kind}"]`)?.value || "";
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function collectPaymentMotifInputs() {
  ensurePaymentMotifs();
  state.paymentMotifs.forEach(motif => {
    const labelInput = document.querySelector(`[data-motif-label="${CSS.escape(motif.key)}"]`);
    const amountInput = document.querySelector(`[data-motif-amount="${CSS.escape(motif.key)}"]`);
    motif.label = labelInput?.value.trim() || motif.label || "Motif";
    motif.amount = Number(amountInput?.value || 0);
  });
}

function addPaymentMotif() {
  collectPaymentMotifInputs();
  state.paymentMotifs.push({
    key: `motif-${Date.now()}`,
    label: "Nouveau motif",
    amount: 0
  });
  saveState();
  renderSettings();
  syncPaymentReasons();
  showToast("Motif ajouté");
}

function addUserAccess() {
  if (!isAdmin()) return;
  collectCurrentUserAccessDraft();
  state.users.push({
    id: nextId(state.users),
    name: "Nouvel utilisateur",
    username: "",
    email: "",
    role: "Secrétaire",
    status: "active",
    permissions: defaultPermissionsForRole("Secrétaire")
  });
  renderSettings();
}

function collectCurrentUserAccessDraft() {
  if (!ids.userAccessSettings) return;
  const rows = [...document.querySelectorAll("[data-user-access-row]")];
  if (!rows.length) return;
  state.users = rows.map(row => {
    const idText = row.dataset.userAccessRow;
    const id = Number(idText);
    const existing = state.users.find(user => Number(user.id) === id) || {};
    const roleInput = row.querySelector(`[data-user-role="${CSS.escape(idText)}"]`);
    const role = roleCode(existing.role) === "administrateur" ? "Administrateur" : (roleInput?.value || existing.role || "Secrétaire");
    return {
      ...existing,
      id,
      name: row.querySelector(`[data-user-name="${CSS.escape(idText)}"]`)?.value.trim() || existing.name || "Utilisateur",
      username: normalizeUsername(row.querySelector(`[data-user-username="${CSS.escape(idText)}"]`)?.value || existing.username || ""),
      email: row.querySelector(`[data-user-email="${CSS.escape(idText)}"]`)?.value.trim().toLowerCase() || existing.email || "",
      role,
      status: roleCode(role) === "administrateur" ? "active" : (row.querySelector(`[data-user-status="${CSS.escape(idText)}"]`)?.value || existing.status || "active"),
      permissions: roleCode(role) === "administrateur"
        ? [...ACCESS_VIEWS]
        : [...row.querySelectorAll(`[data-user-permission="${CSS.escape(idText)}"]:checked`)].map(input => input.value)
    };
  });
}

function handleActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  if (action === "edit-student") editStudent(id);
  if (action === "enroll-student") prepareEnrollmentForStudent(id);
  if (action === "print-student-file") printStudentFile(id);
  if (action === "delete-student") deleteStudent(id);
  if (action === "edit-course") editCourse(id);
  if (action === "delete-course") deleteCourse(id);
  if (action === "edit-group") editGroup(id);
  if (action === "delete-group") deleteGroup(id);
  if (action === "edit-enrollment") editEnrollment(id);
  if (action === "delete-enrollment") deleteEnrollment(id);
  if (action === "pay-enrollment") startPayment(id);
  if (action === "pay-alert") startPayment(id, button.dataset.reason);
  if (action === "print-enrollment") printEnrollment(id);
  if (action === "print-attestation") printAttestation(id);
  if (action === "print-contract") printTrainingContract(id);
  if (action === "print-receipt") printReceipt(id);
  if (action === "edit-payment") editPayment(id);
  if (action === "delete-payment") deletePayment(id);
  if (action === "delete-cash-entry") deleteCashEntry(id);
  if (action === "edit-planning-event") editPlanningEvent(id);
  if (action === "delete-planning-event") deletePlanningEvent(id);
  if (action === "edit-announcement") editAnnouncement(id);
  if (action === "delete-announcement") deleteAnnouncement(id);
  if (action === "edit-room") editRoom(id);
  if (action === "delete-room") deleteRoom(id);
  if (action === "edit-equipment") editEquipment(id);
  if (action === "delete-equipment") deleteEquipment(id);
  if (action === "edit-trainer") editTrainer(id);
  if (action === "delete-trainer") deleteTrainer(id);
  if (action === "edit-staff") editStaff(id);
  if (action === "delete-staff") deleteStaff(id);
  if (action === "delete-staff-payment") deleteStaffPayment(id);
  if (action === "print-payroll-slip") printPayrollSlip(id);
  if (action === "edit-evaluation") editEvaluation(id);
  if (action === "delete-evaluation") deleteEvaluation(id);
  if (action === "print-grades") printGradesReport(id);
  if (action === "go-view") setView(button.dataset.view || "dashboard");
  if (action === "delete-motif") deletePaymentMotif(button.dataset.key);
  if (action === "add-course-fee") addCourseFee(Number(button.dataset.courseId));
  if (action === "delete-course-fee") deleteCourseFee(Number(button.dataset.courseId), button.dataset.feeId);
  if (action === "rename-person-document") renamePersonDocument(button.dataset.kind, button.dataset.index);
  if (action === "delete-person-document") deletePersonDocument(button.dataset.kind, button.dataset.index);
  if (action === "edit-document-template") editDocumentTemplate(button.dataset.key);
  if (action === "delete-document-template") deleteDocumentTemplate(button.dataset.key);
  if (action === "delete-user-access") deleteUserAccess(id);
  if (action === "mark-password-reset-done") markPasswordResetDone(id);
  if (action === "online-request-status") updateOnlineRequestStatus(id, button.dataset.status);
  if (action === "convert-online-request") convertOnlineRequest(id);
}

function updateOnlineRequestStatus(id, status) {
  const request = (state.onlineRegistrationRequests || []).find(item => Number(item.id) === Number(id));
  if (!request) return;
  request.status = status || request.status || "verification";
  request.statusLabel = onlineRequestStatusLabel(request.status);
  request.updatedAt = new Date().toISOString();
  request.updatedBy = currentOperatorName();
  const notifications = [
    {
      id: nextId(state.notifications || []),
      audience: "backoffice",
      type: "online-registration-status",
      title: "Statut de demande mis a jour",
      message: `${request.requestNumber || `DEM-${request.id}`} : ${onlineRequestStatusLabel(request.status)}`,
      status: "unread",
      createdAt: new Date().toISOString(),
      targetId: request.id
    }
  ];
  const requestStudentId = Number(request.studentId || request.existingStudentId || 0);
  if (requestStudentId) {
    notifications.push({
      id: nextId([...(state.notifications || []), ...notifications]),
      audience: "student",
      studentId: requestStudentId,
      type: "online-registration-status",
      title: "Suivi de votre demande",
      message: `Votre demande ${request.requestNumber || `DEM-${request.id}`} est maintenant : ${onlineRequestStatusLabel(request.status)}.`,
      status: "unread",
      createdAt: new Date().toISOString(),
      targetId: request.id
    });
  }
  state.notifications = [
    ...(state.notifications || []),
    ...notifications
  ];
  saveState();
  renderOnlineRequests();
  renderDashboard();
  showToast("Statut de la demande mis a jour");
}

function convertOnlineRequest(id) {
  const request = (state.onlineRegistrationRequests || []).find(item => Number(item.id) === Number(id));
  if (!request || String(request.status || "") === "convertie") return;
  const course = getCourse(request.courseId);
  if (!course) {
    showToast("Formation introuvable");
    return;
  }
  const preferredType = String(request.preferredCourseType || "").toLowerCase();
  const group = state.groups.find(item =>
    Number(item.courseId) === Number(request.courseId) &&
    String(item.status || "active") === "active" &&
    (!preferredType || String(item.sessionType || "").toLowerCase() === preferredType)
  ) || state.groups.find(item => Number(item.courseId) === Number(request.courseId) && String(item.status || "active") === "active");

  let student = request.existingStudentId ? getStudent(request.existingStudentId) : null;
  if (!student) {
    const now = new Date().toISOString();
    student = {
      id: nextId(state.students),
      matricule: generateMatricule(yearFromDate()),
      firstName: request.firstName || "",
      lastName: String(request.lastName || "").toUpperCase(),
      gender: request.gender || "",
      birthDate: request.birthDate || "",
      birthPlace: request.birthPlace || "",
      nationality: request.nationality || "",
      phone: request.phone || "",
      email: request.email || "",
      address: request.address || "",
      district: request.district || "",
      city: request.city || "",
      country: request.country || "",
      studyLevel: request.studyLevel || "",
      profession: request.profession || "",
      desiredCourseId: Number(request.courseId || 0),
      emergencyName: request.emergencyName || "",
      emergencyPhone: request.emergencyPhone || "",
      paymentResponsible: request.paymentResponsible || "",
      paymentResponsiblePhone: request.paymentResponsiblePhone || "",
      source: request.source || "site-web",
      observation: request.message || "",
      status: "preinscrit",
      photoData: "",
      documents: Array.isArray(request.documents) ? request.documents : [],
      documentStatus: Array.isArray(request.documents) && request.documents.length ? "fourni" : "manquant",
      documentObservation: "",
      createdAt: now,
      updatedAt: now,
      createdBy: currentOperatorName(),
      updatedBy: currentOperatorName()
    };
    state.students.push(student);
  }

  const duplicateEnrollment = state.enrollments.some(enrollment =>
    Number(enrollment.studentId) === Number(student.id) &&
    Number(enrollment.courseId) === Number(request.courseId) &&
    Number(enrollment.groupId || 0) === Number(group?.id || 0) &&
    isActiveEnrollment(enrollment)
  );
  if (duplicateEnrollment) {
    showToast("Une inscription existe deja pour cette formation/promotion");
    return;
  }

  const version = getCourseVersion(course, group?.versionId || group?.formationVersionId) || activeCourseVersion(course);
  const enrollmentId = nextId(state.enrollments);
  const copiedFees = buildEnrollmentCopiedFees({
    enrollmentId,
    course,
    version,
    discountAmount: 0
  });
  const totalAmount = copiedFees.filter(isTuitionFee).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0) || courseCost(course);
  const now = new Date().toISOString();
  const enrollment = {
    id: enrollmentId,
    studentId: student.id,
    courseId: Number(request.courseId),
    versionId: version?.id || "",
    formationVersionId: version?.id || "",
    groupId: Number(group?.id || 0),
    courseType: group?.sessionType || request.preferredCourseType || "jour",
    academicYear: group?.year || yearFromDate(),
    registrationFee: Number(course.registrationFee || 0),
    date: today(),
    totalAmount,
    discountAmount: 0,
    finalAmount: totalAmount,
    copiedFees,
    enrollmentFees: copiedFees,
    totalScolarite: totalAmount,
    totalFraisAnnexes: copiedFees.filter(fee => !isTuitionFee(fee) && fee.required).reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
    totalGeneral: copiedFees.reduce((sum, fee) => sum + Number(fee.amountFinal ?? fee.amount ?? 0), 0),
    monthlyFee: Number(course.monthlyFee || 0),
    status: "en attente",
    source: "online",
    onlineRequestId: request.id,
    observation: request.message || "",
    createdAt: now,
    updatedAt: now,
    createdBy: currentOperatorName(),
    updatedBy: currentOperatorName()
  };
  state.enrollments.push(enrollment);
  state.studentAccounts = [
    ...(state.studentAccounts || []),
    {
      id: nextId(state.studentAccounts || []),
      studentId: student.id,
      matricule: student.matricule,
      email: student.email || "",
      phone: student.phone || "",
      authMode: "matricule-phone",
      status: "actif",
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  request.status = "convertie";
  request.statusLabel = onlineRequestStatusLabel(request.status);
  request.studentId = student.id;
  request.enrollmentId = enrollment.id;
  request.convertedAt = new Date().toISOString();
  request.convertedBy = currentOperatorName();
  state.notifications = [
    ...(state.notifications || []),
    {
      id: nextId(state.notifications || []),
      audience: "student",
      studentId: student.id,
      type: "registration-converted",
      title: "Dossier accepte",
      message: `Votre dossier est converti. Matricule : ${student.matricule}`,
      status: "unread",
      createdAt: new Date().toISOString()
    }
  ];
  saveState();
  render();
  showToast(`Demande convertie : ${student.matricule}`);
}

function markPasswordResetDone(id) {
  state.passwordResetRequests = (state.passwordResetRequests || []).map(request => (
    Number(request.id) === Number(id)
      ? { ...request, status: "done", resolvedAt: new Date().toISOString(), resolvedBy: currentOperatorName() }
      : request
  ));
  saveState();
  renderUserAccessSettings();
  showToast("Demande marquée comme traitée");
}

function editStudent(id) {
  const student = getStudent(id);
  if (!student) return;
  const form = document.getElementById("studentForm");
  form.dataset.editId = id;
  document.getElementById("studentFormTitle").textContent = "Modifier étudiant";
  document.getElementById("studentMatricule").value = student.matricule || "";
  updateStudentMatriculeLock();
  document.getElementById("studentFirstName").value = student.firstName || "";
  document.getElementById("studentLastName").value = String(student.lastName || "").toUpperCase();
  document.getElementById("studentGender").value = student.gender || "";
  document.getElementById("studentBirthDate").value = student.birthDate || "";
  document.getElementById("studentBirthPlace").value = student.birthPlace || "";
  document.getElementById("studentNationality").value = student.nationality || "";
  document.getElementById("studentPhone").value = student.phone || "";
  document.getElementById("studentPhone2").value = student.phone2 || student.secondaryPhone || "";
  document.getElementById("studentEmail").value = student.email || "";
  document.getElementById("studentAddress").value = student.address || "";
  document.getElementById("studentDistrict").value = student.district || "";
  document.getElementById("studentCity").value = student.city || "";
  document.getElementById("studentCountry").value = student.country || "";
  document.getElementById("studentStudyLevel").value = student.studyLevel || "";
  document.getElementById("studentProfession").value = student.profession || "";
  document.getElementById("studentDesiredCourse").value = student.desiredCourseId || "";
  document.getElementById("studentFatherName").value = student.fatherName || "";
  document.getElementById("studentFatherPhone").value = student.fatherPhone || "";
  document.getElementById("studentMotherName").value = student.motherName || "";
  document.getElementById("studentMotherPhone").value = student.motherPhone || "";
  document.getElementById("studentEmergencyName").value = student.emergencyName || "";
  document.getElementById("studentEmergencyPhone").value = student.emergencyPhone || "";
  document.getElementById("studentPaymentResponsible").value = student.paymentResponsible || "";
  document.getElementById("studentPaymentResponsiblePhone").value = student.paymentResponsiblePhone || "";
  document.getElementById("studentSource").value = student.source || "";
  document.getElementById("studentObservation").value = student.observation || "";
  document.getElementById("studentDocumentStatus").value = student.documentStatus || (personDocumentCompletion(student, "student").completed ? "valide" : "manquant");
  document.getElementById("studentDocumentObservation").value = student.documentObservation || "";
  document.getElementById("studentStatus").value = student.status || "actif";
  resetPersonFileDraft("student", student);
  setView("students");
}

function prepareEnrollmentForStudent(id) {
  const student = getStudent(id);
  if (!student) return;
  resetEnrollmentForm();
  setView("enrollments");
  document.getElementById("enrollmentStudent").value = String(student.id);
  if (student.desiredCourseId && getCourse(student.desiredCourseId)) {
    document.getElementById("enrollmentCourse").value = String(student.desiredCourseId);
    syncEnrollmentGroups();
    applyCourseCostToEnrollment();
  }
  document.getElementById("enrollmentStatus").value = "validee";
  document.getElementById("enrollmentAcademicYear").value ||= String(new Date().getFullYear());
  document.getElementById("enrollmentCourse").focus();
  showToast(`Inscription preparee pour ${fullName(student)}`);
}

function editCourse(id) {
  const course = getCourse(id);
  if (!course) return;
  const form = document.getElementById("courseForm");
  form.dataset.editId = id;
  document.getElementById("courseFormTitle").textContent = "Modifier formation";
  document.getElementById("courseCode").value = course.code || "";
  document.getElementById("courseName").value = course.name || "";
  document.getElementById("courseDuration").value = course.duration || "";
  document.getElementById("courseRegistrationFee").value = course.registrationFee || 0;
  document.getElementById("courseTrainingFee").value = course.trainingFee || 0;
  document.getElementById("courseMonthlyFee").value = course.monthlyFee || 0;
  document.getElementById("courseDescription").value = course.description || "";
  document.getElementById("courseStatus").value = course.status || "active";
  renderCourseFeePreview(course.id);
  setView("courses");
}

function editGroup(id) {
  const group = getGroup(id);
  if (!group) return;
  const form = document.getElementById("groupForm");
  form.dataset.editId = id;
  document.getElementById("groupFormTitle").textContent = "Modifier promotion";
  document.getElementById("groupName").value = group.name || "";
  document.getElementById("groupCourse").value = group.courseId;
  syncGroupCourseVersions();
  document.getElementById("groupCourseVersion").value = group.versionId || group.formationVersionId || activeCourseVersion(getCourse(group.courseId))?.id || "";
  document.getElementById("groupYear").value = group.year || "";
  document.getElementById("groupSessionType").value = group.sessionType || "jour";
  const trainerSelect = document.getElementById("groupTrainer");
  const trainerId = Number(group.trainerId || 0);
  if (trainerId && [...trainerSelect.options].some(option => Number(option.value) === trainerId)) {
    trainerSelect.value = String(trainerId);
  } else {
    const trainerMatch = state.trainers.find(trainer => trainerName(trainer) === group.trainer);
    trainerSelect.value = trainerMatch ? String(trainerMatch.id) : "";
  }
  document.getElementById("groupCapacity").value = group.capacity || "";
  document.getElementById("groupStartDate").value = group.startDate || "";
  document.getElementById("groupEndDate").value = group.endDate || "";
  document.getElementById("groupStatus").value = group.status || "active";
  setView("groups");
}

function editEnrollment(id) {
  const enrollment = getEnrollment(id);
  if (!enrollment) return;
  const form = document.getElementById("enrollmentForm");
  form.dataset.editId = id;
  document.getElementById("enrollmentFormTitle").textContent = "Modifier inscription";
  document.getElementById("enrollmentStudent").value = enrollment.studentId;
  document.getElementById("enrollmentCourse").value = enrollment.courseId;
  syncEnrollmentCourseVersions();
  document.getElementById("enrollmentCourseVersion").value = enrollment.versionId || enrollment.formationVersionId || activeCourseVersion(getCourse(enrollment.courseId))?.id || "";
  syncEnrollmentGroups();
  document.getElementById("enrollmentGroup").value = enrollment.groupId;
  document.getElementById("enrollmentCourseType").value = enrollmentCourseType(enrollment);
  document.getElementById("enrollmentDate").value = enrollment.date || today();
  document.getElementById("enrollmentAcademicYear").value = enrollment.academicYear || getGroup(enrollment.groupId)?.year || yearFromDate(enrollment.date || today());
  document.getElementById("enrollmentRegistrationFee").value = enrollment.registrationFee ?? getCourse(enrollment.courseId)?.registrationFee ?? 0;
  document.getElementById("enrollmentTotal").value = enrollment.totalAmount || 0;
  document.getElementById("enrollmentDiscount").value = enrollment.discountAmount || 0;
  document.getElementById("enrollmentFinal").value = enrollment.finalAmount ?? 0;
  document.getElementById("enrollmentMonthlyFee").value = enrollment.monthlyFee ?? getCourse(enrollment.courseId)?.monthlyFee ?? 0;
  document.getElementById("enrollmentStatus").value = normalizeEnrollmentStatus(enrollment.status || "validee");
  document.getElementById("enrollmentObservation").value = enrollment.observation || enrollment.note || "";
  setView("enrollments");
}

function editPayment(id) {
  if (!canControlPayments()) {
    showToast("Seul l'administrateur peut corriger un paiement");
    return;
  }
  const payment = findById(state.payments, id);
  if (!payment) return;
  const form = document.getElementById("paymentForm");
  form.dataset.editId = id;
  setView("payments");
  document.getElementById("paymentFormTitle").textContent = `Modifier ${payment.receiptNumber || "paiement"}`;
  document.getElementById("paymentSubmitButton").textContent = "Enregistrer la correction";
  document.getElementById("paymentCancelEdit").hidden = false;
  document.getElementById("paymentEnrollment").value = payment.enrollmentId;
  syncPaymentReasons();
  document.getElementById("paymentReason").value = payment.reasonKey || "scolarite";
  updatePaymentBalance();
  updatePaymentReasonFields();
  document.getElementById("paymentAmount").value = payment.amount || 0;
  document.getElementById("paymentMethod").value = payment.method || "Espèce";
  document.getElementById("paymentDate").value = payment.date || today();
  document.getElementById("paymentAmount").focus();
}

function editTrainer(id) {
  const trainer = getTrainer(id);
  if (!trainer) return;
  const form = document.getElementById("trainerForm");
  form.dataset.editId = id;
  document.getElementById("trainerFormTitle").textContent = "Modifier formateur";
  document.getElementById("trainerFirstName").value = trainer.firstName || "";
  document.getElementById("trainerLastName").value = String(trainer.lastName || "").toUpperCase();
  document.getElementById("trainerPhone").value = trainer.phone || "";
  document.getElementById("trainerEmail").value = trainer.email || "";
  document.getElementById("trainerSpecialty").value = trainer.specialty || "";
  document.getElementById("trainerModules").value = trainer.modules || "";
  document.getElementById("trainerStatus").value = trainer.status || "actif";
  resetPersonFileDraft("trainer", trainer);
  setView("trainers");
}

function editStaff(id) {
  const member = getStaffMember(id);
  if (!member) return;
  const form = document.getElementById("staffForm");
  form.dataset.editId = id;
  document.getElementById("staffFormTitle").textContent = "Modifier personnel";
  document.getElementById("staffFirstName").value = member.firstName || "";
  document.getElementById("staffLastName").value = String(member.lastName || "").toUpperCase();
  document.getElementById("staffRole").value = member.role || "";
  document.getElementById("staffSalary").value = member.salary || 0;
  document.getElementById("staffPhone").value = member.phone || "";
  document.getElementById("staffEmail").value = member.email || "";
  document.getElementById("staffStatus").value = member.status || "actif";
  resetPersonFileDraft("staff", member);
  setView("staff");
}

function editEvaluation(id) {
  const evaluation = getEvaluation(id);
  if (!evaluation) return;
  setView("grades");
  const form = document.getElementById("evaluationForm");
  form.dataset.editId = id;
  document.getElementById("evaluationFormTitle").textContent = "Modifier évaluation";
  document.getElementById("evaluationTitle").value = evaluation.title || "";
  document.getElementById("evaluationGroup").value = evaluation.groupId;
  document.getElementById("evaluationTrainer").value = evaluation.trainerId || "";
  document.getElementById("evaluationType").value = evaluation.type || "devoir";
  document.getElementById("evaluationDate").value = evaluation.date || today();
  document.getElementById("evaluationMaxScore").value = evaluation.maxScore || 20;
  updateEvaluationStudents(evaluation.grades || []);
}

function cleanupStudentLinks(id) {
  const enrollmentIds = state.enrollments
    .filter(enrollment => Number(enrollment.studentId) === id)
    .map(enrollment => Number(enrollment.id));
  const enrollmentIdSet = new Set(enrollmentIds);
  const paymentCount = state.payments.filter(payment => enrollmentIdSet.has(Number(payment.enrollmentId))).length;
  state.payments = state.payments.filter(payment => !enrollmentIdSet.has(Number(payment.enrollmentId)));
  state.enrollments = state.enrollments.filter(enrollment => Number(enrollment.studentId) !== id);
  state.attendanceSessions = state.attendanceSessions.map(session => ({
    ...session,
    records: (session.records || []).filter(record => Number(record.studentId) !== id)
  }));
  state.evaluations = state.evaluations.map(evaluation => ({
    ...evaluation,
    grades: (evaluation.grades || []).filter(grade => Number(grade.studentId) !== id)
  }));
  return { enrollments: enrollmentIds.length, payments: paymentCount };
}

function enrollmentLinkedUsage(enrollment) {
  if (!enrollment) return { payments: 0, attendance: 0, grades: 0 };
  const enrollmentId = Number(enrollment.id);
  const studentId = Number(enrollment.studentId);
  const groupId = Number(enrollment.groupId);
  return {
    payments: state.payments.filter(payment => Number(payment.enrollmentId) === enrollmentId).length,
    attendance: state.attendanceSessions.reduce((count, session) => {
      if (Number(session.groupId) !== groupId) return count;
      return count + (session.records || []).filter(record => Number(record.studentId) === studentId).length;
    }, 0),
    grades: state.evaluations.reduce((count, evaluation) => {
      if (Number(evaluation.groupId) !== groupId) return count;
      return count + (evaluation.grades || []).filter(grade => Number(grade.studentId) === studentId).length;
    }, 0)
  };
}

function cleanupEnrollmentLinks(enrollment) {
  const enrollmentId = Number(enrollment.id);
  const studentId = Number(enrollment.studentId);
  const groupId = Number(enrollment.groupId);
  const usage = enrollmentLinkedUsage(enrollment);
  state.payments = state.payments.filter(payment => Number(payment.enrollmentId) !== enrollmentId);
  state.attendanceSessions = state.attendanceSessions.map(session => (
    Number(session.groupId) === groupId
      ? {
          ...session,
          records: (session.records || []).filter(record => Number(record.studentId) !== studentId)
        }
      : session
  ));
  state.evaluations = state.evaluations.map(evaluation => (
    Number(evaluation.groupId) === groupId
      ? {
          ...evaluation,
          grades: (evaluation.grades || []).filter(grade => Number(grade.studentId) !== studentId)
        }
      : evaluation
  ));
  return usage;
}

async function deleteEnrollment(id) {
  const enrollment = getEnrollment(id);
  if (!enrollment) return;
  const usage = enrollmentLinkedUsage(enrollment);
  const hasLinks = usage.payments || usage.attendance || usage.grades;
  if (hasLinks && !isCleanupModeActive()) {
    const reason = prompt("Cette inscription a déjà un historique. Elle sera annulée, pas supprimée. Motif de l'annulation ?");
    if (!reason || reason.trim().length < 4) {
      showToast("Motif d'annulation obligatoire");
      return;
    }
    enrollment.status = "annulee";
    enrollment.observation = [enrollment.observation, `Annulation : ${reason.trim()}`].filter(Boolean).join("\n");
    enrollment.updatedAt = new Date().toISOString();
    enrollment.updatedBy = currentOperatorName();
    const saved = await saveState({ immediate: true });
    if (!saved) return;
    resetEnrollmentForm();
    render();
    showToast("Inscription annulée et conservée dans l'historique");
    return;
  }
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const message = hasLinks
    ? `Mode nettoyage test actif : supprimer l'inscription de ${fullName(student)} en ${course?.name || "formation"} avec ${usage.payments} paiement(s), ${usage.attendance} presence(s) et ${usage.grades} note(s) liee(s) ?`
    : `Supprimer l'inscription de ${fullName(student)} en ${course?.name || "formation"} ?`;
  if (!confirm(message)) return;
  const cleanup = hasLinks ? cleanupEnrollmentLinks(enrollment) : usage;
  state.enrollments = state.enrollments.filter(item => Number(item.id) !== Number(id));
  const saved = await saveState({ immediate: true });
  if (!saved) return;
  resetEnrollmentForm();
  render();
  showToast(hasLinks
    ? `Inscription supprimee avec ${cleanup.payments} paiement(s), ${cleanup.attendance} presence(s) et ${cleanup.grades} note(s)`
    : "Inscription supprimee");
}

async function deleteStudent(id) {
  const linkedEnrollments = state.enrollments.filter(enrollment => Number(enrollment.studentId) === id);
  if (!isCleanupModeActive()) {
    const student = getStudent(id);
    if (!student) return;
    if (!confirm("Voulez-vous archiver cet étudiant au lieu de le supprimer définitivement ?")) return;
    student.status = "archive";
    student.updatedAt = new Date().toISOString();
    student.updatedBy = currentOperatorName();
    const saved = await saveState({ immediate: true });
    if (!saved) return;
    render();
    showToast("Étudiant archivé avec son historique");
    return;
  }
  const message = linkedEnrollments.length
    ? "Mode nettoyage test actif : supprimer cet étudiant avec ses inscriptions, paiements, présences et notes ?"
    : "Supprimer cet étudiant ?";
  if (!confirm(message)) return;
  const cleanup = linkedEnrollments.length ? cleanupStudentLinks(id) : { enrollments: 0, payments: 0 };
  state.students = state.students.filter(student => Number(student.id) !== id);
  const saved = await saveState({ immediate: true });
  if (!saved) return;
  render();
  showToast(cleanup.enrollments
    ? `Étudiant supprimé avec ${cleanup.enrollments} inscription(s) et ${cleanup.payments} paiement(s)`
    : "Étudiant supprimé");
}

function deleteCourse(id) {
  if (state.enrollments.some(enrollment => Number(enrollment.courseId) === id)) {
    showToast("Suppression bloquée : formation utilisée");
    return;
  }
  if (!confirm("Supprimer cette formation ?")) return;
  state.courses = state.courses.filter(course => Number(course.id) !== id);
  saveState();
  render();
  showToast("Formation supprimée");
}

function deleteGroup(id) {
  if (state.enrollments.some(enrollment => Number(enrollment.groupId) === id)) {
    showToast("Suppression bloquée : promotion utilisée");
    return;
  }
  if (!confirm("Supprimer cette promotion ?")) return;
  state.groups = state.groups.filter(group => Number(group.id) !== id);
  saveState();
  render();
  showToast("Promotion supprimée");
}

function deletePayment(id) {
  if (!canControlPayments()) {
    showToast("Seul l'administrateur peut supprimer un paiement");
    return;
  }
  const payment = findById(state.payments, id);
  if (!payment) return;
  const controlReason = controlledPaymentReason("Suppression du paiement");
  if (!controlReason) return;
  if (!confirm("Supprimer ce paiement ?")) return;
  logPaymentControl("Suppression", payment, controlReason, paymentSnapshot(payment), null);
  state.payments = state.payments.filter(payment => Number(payment.id) !== id);
  saveState();
  resetPaymentForm();
  render();
  showToast("Paiement supprime avec controle");
}

function deleteCashEntry(id) {
  const entry = findById(state.cashEntries, id);
  if (entry?.closedAt && !isAdmin()) {
    showToast("Operation cloturee : seul l'administrateur peut la supprimer");
    return;
  }
  if (!confirm("Supprimer cette opération de caisse ?")) return;
  state.cashEntries = state.cashEntries.filter(entry => Number(entry.id) !== id);
  saveState();
  render();
  showToast("Opération supprimée");
}

function deletePaymentMotif(key) {
  if (key === "scolarite" || key === MAKEUP_MOTIF_KEY) {
    showToast("Ce motif est obligatoire");
    return;
  }
  collectPaymentMotifInputs();
  if (state.payments.some(payment => payment.reasonKey === key)) {
    showToast("Suppression bloquée : motif déjà utilisé");
    return;
  }
  if (!confirm("Supprimer ce motif ?")) return;
  state.paymentMotifs = state.paymentMotifs.filter(motif => motif.key !== key);
  saveState();
  render();
  showToast("Motif supprimé");
}

function deleteUserAccess(id) {
  if (!isAdmin()) return;
  if (!state.users.length) {
    showToast("Liste des utilisateurs non chargee. Rechargez la page.");
    return;
  }
  const user = state.users.find(item => Number(item.id) === id);
  if (!user || roleCode(user.role) === "administrateur" || roleCode(user.role) === "admin") {
    showToast("Le compte administrateur ne peut pas être supprimé");
    return;
  }
  collectCurrentUserAccessDraft();
  if (!confirm("Desactiver cet utilisateur ? Il ne pourra plus se connecter.")) return;
  state.users = state.users.map(item => (
    Number(item.id) === id
      ? { ...item, status: "inactive", updatedAt: new Date().toISOString() }
      : item
  ));
  saveState();
  renderSettings();
  showToast("Utilisateur desactive");
}

async function deleteTrainer(id) {
  const usedInEvaluations = state.evaluations.some(evaluation => Number(evaluation.trainerId) === id);
  const usedInPayroll = state.staffPayments.some(payment => payment.payeeType === "trainer" && Number(payment.payeeId) === id);
  if ((usedInEvaluations || usedInPayroll) && !isCleanupModeActive()) {
    showToast("Suppression bloquée : formateur utilisé. Activez le nettoyage test dans Paramètres.");
    return;
  }
  const message = usedInEvaluations || usedInPayroll
    ? "Mode nettoyage test actif : supprimer ce formateur et retirer ses évaluations/paiements liés ?"
    : "Supprimer ce formateur ?";
  if (!confirm(message)) return;
  if (usedInEvaluations || usedInPayroll) {
    state.evaluations = state.evaluations.map(evaluation => (
      Number(evaluation.trainerId) === id ? { ...evaluation, trainerId: 0 } : evaluation
    ));
    state.staffPayments = state.staffPayments.filter(payment => !(payment.payeeType === "trainer" && Number(payment.payeeId) === id));
    state.trainerAttendanceSessions = state.trainerAttendanceSessions.map(session => ({
      ...session,
      records: (session.records || []).filter(record => Number(record.trainerId) !== id)
    }));
  }
  state.trainers = state.trainers.filter(trainer => Number(trainer.id) !== id);
  const saved = await saveState({ immediate: true });
  if (!saved) return;
  render();
  showToast("Formateur supprimé");
}

async function deleteStaff(id) {
  const hasPayments = state.staffPayments.some(payment => (payment.payeeType || "staff") === "staff" && Number(payment.payeeId || payment.staffId) === id);
  if (hasPayments && !isCleanupModeActive()) {
    showToast("Suppression bloquée : paiements enregistrés. Activez le nettoyage test dans Paramètres.");
    return;
  }
  const message = hasPayments
    ? "Mode nettoyage test actif : supprimer ce personnel et ses paiements liés ?"
    : "Supprimer ce personnel ?";
  if (!confirm(message)) return;
  if (hasPayments) {
    state.staffPayments = state.staffPayments.filter(payment => !((payment.payeeType || "staff") === "staff" && Number(payment.payeeId || payment.staffId) === id));
  }
  state.staffMembers = state.staffMembers.filter(member => Number(member.id) !== id);
  const saved = await saveState({ immediate: true });
  if (!saved) return;
  render();
  showToast("Personnel supprimé");
}

function deleteStaffPayment(id) {
  if (!confirm("Supprimer ce paiement personnel ?")) return;
  state.staffPayments = state.staffPayments.filter(payment => Number(payment.id) !== id);
  saveState();
  render();
  showToast("Paiement personnel supprime");
}

function deleteEvaluation(id) {
  if (!confirm("Supprimer cette evaluation ?")) return;
  state.evaluations = state.evaluations.filter(evaluation => Number(evaluation.id) !== id);
  saveState();
  render();
  showToast("Evaluation supprimee");
}

function resetStudentForm() {
  const form = document.getElementById("studentForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("studentFormTitle").textContent = "Nouvel étudiant";
  document.getElementById("studentMatricule").value = generateMatricule(yearFromDate());
  updateStudentMatriculeLock();
  document.getElementById("studentStatus").value = "preinscrit";
  document.getElementById("studentNationality").value = "Togolaise";
  document.getElementById("studentCity").value = "Lome";
  document.getElementById("studentCountry").value = "Togo";
  document.getElementById("studentDesiredCourse").value = "";
  document.getElementById("studentSource").value = "";
  document.getElementById("studentPhone2").value = "";
  document.getElementById("studentDocumentStatus").value = "manquant";
  document.getElementById("studentDocumentObservation").value = "";
  resetPersonFileDraft("student");
}

function resetCourseForm() {
  const form = document.getElementById("courseForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("courseFormTitle").textContent = "Nouvelle formation";
  document.getElementById("courseStatus").value = "active";
  renderCourseFeePreview(0);
}

function resetGroupForm() {
  const form = document.getElementById("groupForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("groupFormTitle").textContent = "Nouvelle promotion";
  document.getElementById("groupYear").value = String(new Date().getFullYear());
  document.getElementById("groupSessionType").value = "jour";
  document.getElementById("groupCourse").value = "";
  syncGroupCourseVersions();
  document.getElementById("groupTrainer").value = "";
}

function resetEnrollmentForm() {
  const form = document.getElementById("enrollmentForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("enrollmentFormTitle").textContent = "Nouvelle inscription";
  document.getElementById("enrollmentDate").value = today();
  document.getElementById("enrollmentDiscount").value = 0;
  syncSelects();
  document.getElementById("enrollmentStudent").value = "";
  document.getElementById("enrollmentCourse").value = "";
  syncEnrollmentCourseVersions();
  syncEnrollmentGroups();
  document.getElementById("enrollmentCourseType").value = "jour";
  document.getElementById("enrollmentAcademicYear").value = String(new Date().getFullYear());
  document.getElementById("enrollmentRegistrationFee").value = "";
  document.getElementById("enrollmentTotal").value = "";
  document.getElementById("enrollmentFinal").value = "";
  document.getElementById("enrollmentMonthlyFee").value = "";
  document.getElementById("enrollmentStatus").value = "en attente";
  document.getElementById("enrollmentObservation").value = "";
}

function resetPaymentForm() {
  const form = document.getElementById("paymentForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("paymentFormTitle").textContent = "Nouveau paiement";
  document.getElementById("paymentSubmitButton").textContent = "Encaisser";
  document.getElementById("paymentCancelEdit").hidden = true;
  document.getElementById("paymentDate").value = today();
  syncSelects();
  document.getElementById("paymentEnrollment").value = "";
  updatePaymentBalance();
  updatePaymentReasonFields();
}

function resetTrainerForm() {
  const form = document.getElementById("trainerForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("trainerFormTitle").textContent = "Nouveau formateur";
  document.getElementById("trainerStatus").value = "actif";
  resetPersonFileDraft("trainer");
}

function resetStaffForm() {
  const form = document.getElementById("staffForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("staffFormTitle").textContent = "Nouveau personnel";
  document.getElementById("staffSalary").value = 0;
  document.getElementById("staffStatus").value = "actif";
  resetPersonFileDraft("staff");
}

function resetEvaluationForm() {
  const form = document.getElementById("evaluationForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("evaluationFormTitle").textContent = "Nouvelle évaluation";
  document.getElementById("evaluationDate").value = today();
  document.getElementById("evaluationMaxScore").value = 20;
  syncSelects();
  updateEvaluationStudents();
}

function applyCourseCostToEnrollment() {
  const course = getCourse(document.getElementById("enrollmentCourse").value);
  if (!course) {
    document.getElementById("enrollmentRegistrationFee").value = "";
    document.getElementById("enrollmentTotal").value = "";
    document.getElementById("enrollmentFinal").value = "";
    document.getElementById("enrollmentMonthlyFee").value = "";
    return;
  }
  const version = getCourseVersion(course, document.getElementById("enrollmentCourseVersion")?.value) || activeCourseVersion(course);
  const summary = courseFeeSummary(course, { versionId: version?.id });
  const registration = summary.fees.find(fee => fee.category === "inscription");
  const hasTuitionFee = summary.fees.some(isTuitionFee);
  document.getElementById("enrollmentRegistrationFee").value = Number(registration?.amount ?? course.registrationFee ?? 0);
  document.getElementById("enrollmentTotal").value = hasTuitionFee ? summary.tuition : courseCost(course);
  document.getElementById("enrollmentMonthlyFee").value = Number(course.monthlyFee || 0);
  document.getElementById("enrollmentAcademicYear").value ||= getGroup(document.getElementById("enrollmentGroup").value)?.year || String(new Date().getFullYear());
  updateEnrollmentFinal();
  renderEnrollmentFeeSummary();
}

function updateEnrollmentFinal() {
  const total = Number(document.getElementById("enrollmentTotal").value || 0);
  const discount = Number(document.getElementById("enrollmentDiscount").value || 0);
  document.getElementById("enrollmentFinal").value = Math.max(0, total - discount);
}

function updatePaymentBalance() {
  const enrollment = getEnrollment(document.getElementById("paymentEnrollment").value);
  const editId = Number(document.getElementById("paymentForm").dataset.editId || 0);
  if (!enrollment) {
    ids.paymentBalance.textContent = "Choisir une inscription";
    return;
  }
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const group = getGroup(enrollment.groupId);
  const balance = editId ? balanceForEnrollmentExcluding(enrollment, editId) : balanceForEnrollment(enrollment);
  const makeupDue = makeupDueForEnrollment(enrollment, editId);
  const feeRows = activeFeesForEnrollment(enrollment).map(fee => {
    const paid = isTuitionFee(fee) ? paidAmount(enrollment.id) : feePaidAmount(enrollment.id, fee, editId);
    const rest = feeBalance(enrollment, fee, editId);
    return `${fee.label}: ${formatMoney(fee.amountFinal ?? fee.amount)} / payé ${formatMoney(paid)} / reste ${formatMoney(rest)}`;
  }).join(" | ");
  ids.paymentBalance.innerHTML = `
    ${escapeHtml(fullName(student))} - ${escapeHtml(course?.name || "-")} / ${escapeHtml(group?.name || "-")}
    | Total ${escapeHtml(formatMoney(tuitionExpectedForEnrollment(enrollment)))}
    | Paye ${escapeHtml(formatMoney(paidAmount(enrollment.id)))}
    | Reste ${escapeHtml(formatMoney(balance))}
    ${feeRows ? `<br>${escapeHtml(feeRows)}` : ""}
    ${makeupDue ? `| Rattrapage ${escapeHtml(formatMoney(makeupDue))}` : ""}
  `;
}

function updatePaymentReasonFields() {
  const reason = document.getElementById("paymentReason").value;
  const amountInput = document.getElementById("paymentAmount");
  const selectedEnrollment = getEnrollment(document.getElementById("paymentEnrollment").value);
  const motif = paymentMotifForReason(reason, selectedEnrollment?.id || 0);
  if (!selectedEnrollment) {
    amountInput.value = "";
    amountInput.removeAttribute("readonly");
    amountInput.placeholder = "Choisissez d'abord une inscription";
    updatePaymentBalance();
    return;
  }
  if (isTuitionMotifKey(reason)) {
    const enrollment = selectedEnrollment;
    const course = enrollment ? getCourse(enrollment.courseId) : undefined;
    const editId = Number(document.getElementById("paymentForm").dataset.editId || 0);
    const balance = editId ? balanceForEnrollmentExcluding(enrollment, editId) : balanceForEnrollment(enrollment);
    const suggested = Number(course?.monthlyFee || 0) || balance;
    amountInput.value = balance > 0 ? Math.min(suggested, balance) : suggested;
    amountInput.removeAttribute("readonly");
    amountInput.step = "1";
    amountInput.placeholder = "Montant payé";
    return;
  }
  const linkedFee = enrollmentFeeFromKey(reason, selectedEnrollment.id) || courseFeeFromKey(reason);
  if (linkedFee) {
    const editId = Number(document.getElementById("paymentForm").dataset.editId || 0);
    const due = feeBalance(selectedEnrollment, linkedFee, editId);
    amountInput.value = due > 0 ? due : "";
    if (linkedFee.once) {
      amountInput.setAttribute("readonly", "readonly");
    } else {
      amountInput.removeAttribute("readonly");
    }
    amountInput.step = "1";
    amountInput.placeholder = `Reste ${formatMoney(due)}`;
    updatePaymentBalance();
    return;
  }
  if (isMakeupMotifKey(reason)) {
    const enrollment = selectedEnrollment;
    const editId = Number(document.getElementById("paymentForm").dataset.editId || 0);
    const due = makeupDueForEnrollment(enrollment, editId);
    amountInput.value = due > 0 ? Math.min(MAKEUP_FEE, due) : "";
    amountInput.removeAttribute("readonly");
    amountInput.step = String(MAKEUP_FEE);
    amountInput.placeholder = `Tranche de ${formatMoney(MAKEUP_FEE)}`;
    updatePaymentBalance();
    return;
  }
  amountInput.value = Number(motif?.amount || 0);
  amountInput.setAttribute("readonly", "readonly");
  amountInput.step = "1";
  amountInput.placeholder = "";
}

function startPayment(enrollmentId, reasonKey = "") {
  setView("payments");
  document.getElementById("paymentEnrollment").value = enrollmentId;
  syncPaymentReasons();
  const reasonSelect = document.getElementById("paymentReason");
  if (reasonKey && [...reasonSelect.options].some(option => option.value === reasonKey)) {
    reasonSelect.value = reasonKey;
  } else if (reasonKey) {
    const enrollment = getEnrollment(enrollmentId);
    const matchingFee = normalizeEnrollmentCopiedFees(enrollment)
      .find(fee => fee.category === reasonKey || (reasonKey === "scolarite" && isTuitionFee(fee)));
    const matchingKey = matchingFee ? enrollmentFeeKey(matchingFee) : "";
    if (matchingKey && [...reasonSelect.options].some(option => option.value === matchingKey && !option.disabled)) {
      reasonSelect.value = matchingKey;
    }
  }
  updatePaymentBalance();
  updatePaymentReasonFields();
  document.getElementById("paymentAmount").focus();
}

const amountInput = document.getElementById("paymentAmount");
if (amountInput) {
  amountInput.focus();
}

function receiptSeriesPrefix(reasonKey) {
  const enrollmentFee = enrollmentFeeFromKey(reasonKey);
  if (enrollmentFee?.category === "inscription") return "REC-INS";
  if (enrollmentFee && isTuitionFee(enrollmentFee)) return "REC-SCO";
  if (enrollmentFee?.category === "rattrapage") return "REC-RAT";
  const courseFee = courseFeeFromKey(reasonKey);
  if (courseFee?.category === "inscription") return "REC-INS";
  if (isTuitionMotifKey(reasonKey)) return "REC-SCO";
  if (isMakeupMotifKey(reasonKey)) return "REC-RAT";
  if (String(reasonKey || "") === "inscription") return "REC-INS";
  return "REC-ANN";
}

function nextReceiptNumber(reasonKey = "scolarite") {
  const year = new Date().getFullYear();
  const prefix = receiptSeriesPrefix(reasonKey);
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const receiptNumbers = [
    ...state.payments.map(payment => payment.receiptNumber),
    ...state.paymentAuditLog.flatMap(item => [item.receiptNumber, item.before?.receiptNumber, item.after?.receiptNumber])
  ].filter(Boolean);
  const maxNumber = receiptNumbers.reduce((max, receiptNumber) => {
    const match = String(receiptNumber).match(pattern);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `${prefix}-${year}-${String(maxNumber + 1).padStart(3, "0")}`;
}

function printStudentFile(studentId) {
  const student = getStudent(studentId);
  if (!student) {
    showToast("Étudiant introuvable");
    return;
  }
  const enrollments = state.enrollments.filter(enrollment => Number(enrollment.studentId) === Number(student.id));
  const enrollmentIds = new Set(enrollments.map(enrollment => Number(enrollment.id)));
  const payments = state.payments.filter(payment => enrollmentIds.has(Number(payment.enrollmentId)));
  const documents = Array.isArray(student.documents) ? student.documents : [];
  const gradeRows = studentGradeRows(student.id);
  const attendanceCount = state.attendanceSessions.reduce((count, session) => (
    count + (session.records || []).filter(record => Number(record.studentId) === Number(student.id)).length
  ), 0);

  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml("Fiche étudiant")}
      <table>
        <tbody>
          <tr><td>Matricule</td><td>${escapeHtml(student.matricule || "-")}</td></tr>
          <tr><td>Étudiant</td><td><strong>${escapeHtml(fullName(student))}</strong></td></tr>
          <tr><td>Sexe</td><td>${escapeHtml(student.gender || "-")}</td></tr>
          <tr><td>Date / lieu de naissance</td><td>${escapeHtml([student.birthDate ? formatDate(student.birthDate) : "", student.birthPlace || ""].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Nationalité</td><td>${escapeHtml(student.nationality || "-")}</td></tr>
          <tr><td>Téléphones</td><td>${escapeHtml([student.phone, student.phone2].filter(Boolean).join(" / ") || "-")}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(student.email || "-")}</td></tr>
          <tr><td>Adresse</td><td>${escapeHtml([student.address, student.district, student.city, student.country].filter(Boolean).join(", ") || "-")}</td></tr>
          <tr><td>Niveau / situation</td><td>${escapeHtml([student.studyLevel, student.profession].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Formation souhaitée</td><td>${escapeHtml(getCourse(student.desiredCourseId)?.name || "-")}</td></tr>
          <tr><td>Parents</td><td>${escapeHtml([student.fatherName ? `Père: ${student.fatherName} ${student.fatherPhone || ""}` : "", student.motherName ? `Mère: ${student.motherName} ${student.motherPhone || ""}` : ""].filter(Boolean).join(" / ") || "-")}</td></tr>
          <tr><td>Personne à contacter</td><td>${escapeHtml([student.emergencyName, student.emergencyPhone].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Responsable paiement</td><td>${escapeHtml([student.paymentResponsible, student.paymentResponsiblePhone].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Statut</td><td>${escapeHtml(student.status || "-")}</td></tr>
        </tbody>
      </table>

      <h2>Dossier documents</h2>
      <table>
        <tbody>
          <tr><td>Statut documents</td><td>${escapeHtml(student.documentStatus || "-")}</td></tr>
          <tr><td>Documents manquants</td><td>${escapeHtml(missingDocumentsText(personDocumentCompletion(student, "student")))}</td></tr>
          <tr><td>Observation</td><td>${escapeHtml(student.documentObservation || "-")}</td></tr>
        </tbody>
      </table>
      <ul>${documents.map(item => `<li>${escapeHtml(item.type || item.name || "Document")} - ${escapeHtml(item.originalName || item.name || "")}</li>`).join("") || "<li>Aucun document ajouté</li>"}</ul>

      <h2>Inscriptions officielles</h2>
      <table>
        <thead>
          <tr><th>Formation</th><th>Promotion</th><th>Type</th><th>Statut</th><th>Scolarité</th><th>Payé</th><th>Reste</th></tr>
        </thead>
        <tbody>
          ${enrollments.map(enrollment => {
            const course = getCourse(enrollment.courseId);
            const group = getGroup(enrollment.groupId);
            return `
              <tr>
                <td>${escapeHtml(course?.name || "-")}</td>
                <td>${escapeHtml(group?.name || "-")}</td>
                <td>${escapeHtml(groupSessionLabel({ sessionType: enrollmentCourseType(enrollment) }))}</td>
                <td>${escapeHtml(enrollment.status || "-")}</td>
                <td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td>
                <td>${formatMoney(paidAmount(enrollment.id))}</td>
                <td>${formatMoney(balanceForEnrollment(enrollment))}</td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="7">Aucune inscription officielle</td></tr>`}
        </tbody>
      </table>

      <h2>Paiements</h2>
      <table>
        <thead><tr><th>Date</th><th>Reçu</th><th>Formation</th><th>Motif</th><th>Montant</th></tr></thead>
        <tbody>
          ${payments.map(payment => {
            const enrollment = getEnrollment(payment.enrollmentId);
            return `
              <tr>
                <td>${formatDate(payment.date)}</td>
                <td>${escapeHtml(payment.receiptNumber || "-")}</td>
                <td>${escapeHtml(getCourse(enrollment?.courseId)?.name || "-")}</td>
                <td>${escapeHtml(payment.reason || "-")}</td>
                <td>${formatMoney(payment.amount)}</td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="5">Aucun paiement</td></tr>`}
        </tbody>
      </table>

      <h2>Notes et présences</h2>
      <p>Notes enregistrées : ${gradeRows.length} | Présences enregistrées : ${attendanceCount}</p>
      <p style="margin-top: 42px;">Signature et cachet</p>
    </section>
  `;
  showPrintPreview("Fiche étudiant");
}

function printReceipt(paymentId) {
  const payment = findById(state.payments, paymentId);
  if (!payment) return;
  const enrollment = getEnrollment(payment.enrollmentId);
  const student = enrollment ? getStudent(enrollment.studentId) : undefined;
  const course = enrollment ? getCourse(enrollment.courseId) : undefined;
  const group = enrollment ? getGroup(enrollment.groupId) : undefined;
  const center = state.center || {};
  const logoSrc = normalizeLogoData(center.logoData);
  const stampSrc = normalizeLogoData(center.stampData);
  const tuitionPayment = isTuitionPayment(payment);
  const linkedFee = enrollmentFeeFromKey(payment.reasonKey, payment.enrollmentId) || courseFeeFromKey(payment.reasonKey);
  const expected = tuitionPayment
    ? tuitionExpectedForEnrollment(enrollment)
    : Number(linkedFee?.amountFinal ?? linkedFee?.amount ?? payment.amount ?? 0);
  const balance = tuitionPayment ? balanceForEnrollment(enrollment) : (linkedFee ? feeBalance(enrollment, linkedFee) : 0);
  const academicYear = group?.year || yearFromDate(enrollment?.date || payment.date);
  const receiptTitle = tuitionPayment
    ? "REÇU DE SCOLARITÉ"
    : `REÇU - ${String(payment.reason || "FRAIS ANNEXE").toUpperCase()}`;
  const summaryHeaders = tuitionPayment
    ? ["ANNEE", "Formation", "Scolarité", "Reste scolarité"]
    : ["ANNEE", "Formation", "Frais annexe", "Statut"];
  const summaryValues = tuitionPayment
    ? [academicYear, course?.code || "-", formatPrintAmount(expected), formatPrintAmount(balance)]
    : [academicYear, course?.code || "-", payment.reason || "Frais annexe", "Payé"];
  const recorder = currentUser?.name || payment.receivedBy || document.getElementById("roleSelect").value;
  const receiptDateTime = formatDateTime(new Date());
  ids.printArea.innerHTML = `
    <section class="print-document receipt-document">
      <header class="receipt-header-grid">
        <div class="receipt-school">
          <h1>${escapeHtml(center.name || "CFP EREXIT")}</h1>
          <p>${escapeHtml(center.subtitle || "Centre de Formation Professionnelle")}</p>
        </div>
        <div class="receipt-republic">
          <h2>REPUBLIQUE TOGOLAISE</h2>
          <p>Travail - Liberté - Patrie</p>
        </div>
      </header>

      <div class="receipt-logo-wrap">
        ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="">` : ""}
      </div>

      <div class="receipt-contact">
        <strong>${center.phone ? `TEL : ${escapeHtml(center.phone)}` : ""}</strong>
        <span>${escapeHtml(center.address || "")}</span>
        ${center.email ? `<span>${escapeHtml(center.email)}</span>` : ""}
      </div>

      <h2 class="receipt-type">${escapeHtml(receiptTitle)}</h2>

      <div class="receipt-topline">
        <div class="receipt-reference">RÉFÉRENCE : ${escapeHtml(payment.receiptNumber)}</div>
        <table class="receipt-summary-table">
          <thead>
            <tr>
              ${summaryHeaders.map(header => `<th>${escapeHtml(header)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(summaryValues[0])}</td>
              <td>
                <strong>${escapeHtml(summaryValues[1])}</strong>
                <div>${escapeHtml(groupSessionLabel(group))}</div>
              </td>
              <td>${escapeHtml(summaryValues[2])}</td>
              <td>${escapeHtml(summaryValues[3])}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="receipt-student">ÉTUDIANT : ${escapeHtml(fullName(student))}</h2>

      <table class="receipt-lines-table">
        <thead>
          <tr>
            <th>Libellé</th>
            <th>Date paiement</th>
            <th>Montant payé</th>
            <th>Mode de paiement</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(payment.reason || "Paiement")}</td>
            <td>${formatDate(payment.date)}</td>
            <td>${formatPrintAmount(payment.amount)}</td>
            <td>${escapeHtml(payment.method || "-")}</td>
          </tr>
          <tr>
            <td colspan="2"><strong>TOTAL</strong></td>
            <td colspan="2"><strong>${formatPrintAmount(payment.amount)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="receipt-extra">
        <p><strong>Matricule :</strong> ${escapeHtml(student?.matricule || "-")}</p>
        <p><strong>Categorie :</strong> ${escapeHtml(tuitionPayment ? "Scolarité" : feeCategoryLabel(linkedFee?.category || payment.category || "autre"))}</p>
        <p><strong>Statut du recu :</strong> ${escapeHtml(payment.status || "valide")}</p>
        <p><strong>Montant en lettres :</strong> ${escapeHtml(amountToWords(payment.amount))}</p>
      </div>

      <div class="receipt-responsibles">
        <div>
          <strong>Responsable saisie : ${escapeHtml(recorder)}</strong>
          <span>Ce ${escapeHtml(receiptDateTime)}</span>
        </div>
        <div>
          <strong>Responsable caisse : ${escapeHtml(payment.receivedBy || recorder)}</strong>
          <span>Ce ${escapeHtml(receiptDateTime)}</span>
        </div>
      </div>

      <div class="receipt-signature">
        ${stampSrc ? `<img src="${escapeHtml(stampSrc)}" alt="">` : ""}
        <span>Signature et cachet</span>
      </div>

      <p class="receipt-note"><strong>NB :</strong> Aucun remboursement n'est accepté après encaissement. Merci</p>
    </section>
  `;
  showPrintPreview();
}

function printPayrollSlip(paymentId) {
  const payment = state.staffPayments.find(item => Number(item.id) === Number(paymentId));
  if (!payment) return;
  const beneficiary = payrollBeneficiary(payment);
  const title = beneficiary.type === "trainer" ? "Fiche de paie formateur" : "Fiche de paie personnel";
  const center = state.center || {};
  const period = payment.period || today().slice(0, 7);
  const periodLabel = period.includes("-")
    ? new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${period}-01T00:00:00`))
    : period;
  const reference = `PAY-${String(payment.id).padStart(5, "0")}`;
  const recorder = payment.recordedBy || currentOperatorName();

  ids.printArea.innerHTML = `
    <section class="print-document payroll-document">
      ${printHeaderHtml(title)}
      <table>
        <tbody>
          <tr><td>Employeur</td><td><strong>${escapeHtml(center.name || "CFP EREXIT")}</strong></td></tr>
          <tr><td>Téléphone</td><td>${escapeHtml(center.phone || "-")}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(center.email || "-")}</td></tr>
          <tr><td>Adresse</td><td>${escapeHtml(center.address || "-")}</td></tr>
        </tbody>
      </table>

      <h2>Bénéficiaire</h2>
      <table>
        <tbody>
          <tr><td>Bénéficiaire</td><td><strong>${escapeHtml(beneficiary.name)}</strong></td></tr>
          <tr><td>Catégorie</td><td>${escapeHtml(beneficiary.type === "trainer" ? "Formateur" : "Personnel")}</td></tr>
          <tr><td>Fonction / rôle</td><td>${escapeHtml(beneficiary.role || "-")}</td></tr>
          <tr><td>Téléphone</td><td>${escapeHtml(beneficiary.phone || "-")}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(beneficiary.email || "-")}</td></tr>
          <tr><td>Période</td><td>${escapeHtml(periodLabel)}</td></tr>
          <tr><td>Date de paiement</td><td>${formatDate(payment.date)}</td></tr>
          <tr><td>Mode de paiement</td><td>${escapeHtml(payment.method || "-")}</td></tr>
          <tr><td>Référence interne</td><td>${escapeHtml(reference)}</td></tr>
        </tbody>
      </table>

      <table style="margin-top: 20px;">
        <thead>
          <tr>
            <th>Libellé</th>
            <th>Note</th>
            <th>Salaire prévu</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(payment.reason || "Paiement")}</td>
            <td>${escapeHtml(payment.note || "-")}</td>
            <td>${formatMoney(beneficiary.baseSalary || 0)}</td>
            <td><strong>${formatMoney(payment.amount)}</strong></td>
          </tr>
          <tr>
            <td colspan="3"><strong>Net payé</strong></td>
            <td><strong>${formatMoney(payment.amount)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="print-signature-row">
        <p>Responsable caisse<br><span>${escapeHtml(recorder)}</span></p>
        <p>Bénéficiaire</p>
      </div>
      <p class="muted" style="margin-top: 18px;">Document généré le ${escapeHtml(formatDateTime(new Date()))}</p>
    </section>
  `;
  showPrintPreview();
}

function printEnrollment(enrollmentId) {
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return;
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const group = getGroup(enrollment.groupId);
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml("Fiche d'inscription")}
      <table>
        <tbody>
          <tr><td>Matricule</td><td>${escapeHtml(student?.matricule || "-")}</td></tr>
          <tr><td>Sexe</td><td>${escapeHtml(student?.gender || "-")}</td></tr>
          <tr><td>Date / lieu de naissance</td><td>${escapeHtml([student?.birthDate ? formatDate(student.birthDate) : "", student?.birthPlace || ""].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Nationalite</td><td>${escapeHtml(student?.nationality || "-")}</td></tr>
          <tr><td>Adresse complete</td><td>${escapeHtml([student?.address, student?.district, student?.city, student?.country].filter(Boolean).join(", ") || "-")}</td></tr>
          <tr><td>Niveau / situation</td><td>${escapeHtml([student?.studyLevel, student?.profession].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Parents</td><td>${escapeHtml([student?.fatherName ? `Pere: ${student.fatherName} ${student.fatherPhone || ""}` : "", student?.motherName ? `Mere: ${student.motherName} ${student.motherPhone || ""}` : ""].filter(Boolean).join(" / ") || "-")}</td></tr>
          <tr><td>Personne a contacter</td><td>${escapeHtml([student?.emergencyName, student?.emergencyPhone].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Responsable paiement</td><td>${escapeHtml([student?.paymentResponsible, student?.paymentResponsiblePhone].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Source / observation</td><td>${escapeHtml([student?.source, student?.observation].filter(Boolean).join(" - ") || "-")}</td></tr>
          <tr><td>Étudiant</td><td><strong>${escapeHtml(fullName(student))}</strong></td></tr>
          <tr><td>Téléphone</td><td>${escapeHtml(student?.phone || "-")}</td></tr>
          <tr><td>Formation</td><td>${escapeHtml(course?.name || "-")}</td></tr>
          <tr><td>Promotion</td><td>${escapeHtml(group?.name || "-")}</td></tr>
          <tr><td>Type de cours</td><td>${escapeHtml(groupSessionLabel(group))}</td></tr>
          <tr><td>Date</td><td>${formatDate(enrollment.date)}</td></tr>
          <tr><td>Scolarité exigible</td><td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td></tr>
          <tr><td>Scolarité payée</td><td>${formatMoney(paidAmount(enrollment.id))}</td></tr>
          <tr><td>Frais annexes payés</td><td>${formatMoney(annexPaidAmount(enrollment.id))}</td></tr>
          <tr><td>Total payé</td><td>${formatMoney(totalPaidAmountForEnrollment(enrollment.id))}</td></tr>
          <tr><td>Reste scolarité</td><td>${formatMoney(balanceForEnrollment(enrollment))}</td></tr>
        </tbody>
      </table>
      <p style="margin-top: 42px;">Signature et cachet</p>
    </section>
  `;
  showPrintPreview();
}

function printAttestation(enrollmentId) {
  const template = templateByKey("attestation-inscription");
  if (template && template.status !== "archive") {
    printTemplateDocument("attestation-inscription", { enrollmentId });
    return;
  }
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return;
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const group = getGroup(enrollment.groupId);
  const center = state.center || {};
  const stampSrc = normalizeLogoData(center.stampData);
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml("Attestation d'inscription")}
      <p style="margin-top: 28px; line-height: 1.8; font-size: 15px;">
        Nous soussignés <strong>${escapeHtml(center.name || "CFP EREXIT")}</strong>,
        attestons que <strong>${escapeHtml(fullName(student))}</strong>,
        matricule <strong>${escapeHtml(student?.matricule || "-")}</strong>, est régulièrement inscrit(e)
        à la formation <strong>${escapeHtml(course?.name || "-")}</strong>,
        promotion <strong>${escapeHtml(group?.name || "-")}</strong>
        (${escapeHtml(groupSessionLabel(group))}), pour l'année ${escapeHtml(group?.year || yearFromDate(enrollment.date))}.
      </p>
      <table style="margin-top: 22px;">
        <tbody>
          <tr><td>Date d'inscription</td><td>${formatDate(enrollment.date)}</td></tr>
          <tr><td>Scolarité exigible</td><td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td></tr>
          <tr><td>Scolarité payée</td><td>${formatMoney(paidAmount(enrollment.id))}</td></tr>
          <tr><td>Reste scolarité</td><td>${formatMoney(balanceForEnrollment(enrollment))}</td></tr>
        </tbody>
      </table>
      <p style="margin-top: 28px;">Fait pour servir et valoir ce que de droit.</p>
      <div class="document-signature">
        ${stampSrc ? `<img src="${escapeHtml(stampSrc)}" alt="">` : ""}
        <strong>Signature et cachet</strong>
      </div>
    </section>
  `;
  showPrintPreview();
}

function printTrainingContract(enrollmentId) {
  const template = templateByKey("contrat-formation");
  if (template && template.status !== "archive") {
    printTemplateDocument("contrat-formation", { enrollmentId });
    return;
  }
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return;
  const student = getStudent(enrollment.studentId);
  const course = getCourse(enrollment.courseId);
  const group = getGroup(enrollment.groupId);
  const center = state.center || {};
  const stampSrc = normalizeLogoData(center.stampData);
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml("Contrat de formation")}
      <table>
        <tbody>
          <tr><td>Centre</td><td>${escapeHtml(center.name || "CFP EREXIT")}</td></tr>
          <tr><td>Étudiant</td><td><strong>${escapeHtml(fullName(student))}</strong></td></tr>
          <tr><td>Matricule</td><td>${escapeHtml(student?.matricule || "-")}</td></tr>
          <tr><td>Formation</td><td>${escapeHtml(course?.name || "-")}</td></tr>
          <tr><td>Type de cours</td><td>${escapeHtml(groupSessionLabel(group))}</td></tr>
          <tr><td>Durée</td><td>${escapeHtml(course?.duration || "-")}</td></tr>
          <tr><td>Scolarité exigible</td><td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td></tr>
          <tr><td>Mensualité indicative</td><td>${formatMoney(course?.monthlyFee || 0)}</td></tr>
        </tbody>
      </table>
      <h2>Engagements</h2>
      <p>L'étudiant s'engage à respecter le règlement intérieur, les horaires, le programme pédagogique et les modalités de paiement convenues.</p>
      <p>Le centre s'engage à assurer la formation conformément au programme prévu et à suivre la progression de l'étudiant.</p>
      <div class="contract-signatures">
        <div>
          <strong>L'étudiant</strong>
          <span>Signature</span>
        </div>
        <div>
          ${stampSrc ? `<img src="${escapeHtml(stampSrc)}" alt="">` : ""}
          <strong>Le centre</strong>
          <span>Signature et cachet</span>
        </div>
      </div>
    </section>
  `;
  showPrintPreview();
}

function printBalancesReport() {
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml(`Rapport des restes scolarité - ${formatDate(today())}`)}
      <table>
        <thead>
          <tr>
            <th>Étudiant</th>
            <th>Formation</th>
            <th>Type</th>
            <th>Scolarité exigible</th>
            <th>Scolarité payée</th>
            <th>Reste scolarité</th>
          </tr>
        </thead>
        <tbody>
          ${balances().map(item => `
            <tr>
              <td>${escapeHtml(item.student)}</td>
              <td>${escapeHtml(item.course)}</td>
              <td>${escapeHtml(item.sessionType)}</td>
              <td>${formatMoney(item.tuitionExpected)}</td>
              <td>${formatMoney(item.paid)}</td>
              <td>${formatMoney(item.balance)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
  showPrintPreview();
}

function printIndividualStudentReport() {
  const report = individualStudentReportData();
  const { student, enrollments, payments, paymentsByMotif, tuitionExpected, tuitionPaid, annexPaid, totalPaid, balance } = report;
  if (!student) {
    showToast("Aucun étudiant sélectionné");
    return;
  }

  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml(`Rapport individuel étudiant - ${formatDate(today())}`)}
      <table>
        <tbody>
          <tr><td>Matricule</td><td>${escapeHtml(student.matricule || "-")}</td></tr>
          <tr><td>Étudiant</td><td><strong>${escapeHtml(fullName(student))}</strong></td></tr>
          <tr><td>Téléphone</td><td>${escapeHtml(student.phone || "-")}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(student.email || "-")}</td></tr>
          <tr><td>Adresse</td><td>${escapeHtml(student.address || "-")}</td></tr>
          <tr><td>Statut</td><td>${escapeHtml(student.status || "-")}</td></tr>
        </tbody>
      </table>

      <h2>Inscriptions</h2>
      <table>
        <thead>
          <tr>
            <th>Formation</th>
            <th>Promotion</th>
            <th>Type</th>
            <th>Date</th>
            <th>Scolarité exigible</th>
            <th>Reste</th>
          </tr>
        </thead>
        <tbody>
          ${enrollments.map(enrollment => {
            const course = getCourse(enrollment.courseId);
            const group = getGroup(enrollment.groupId);
            return `
              <tr>
                <td>${escapeHtml(course?.name || "-")}</td>
                <td>${escapeHtml(group?.name || "-")}</td>
                <td>${escapeHtml(groupSessionLabel(group))}</td>
                <td>${formatDate(enrollment.date)}</td>
                <td>${formatMoney(tuitionExpectedForEnrollment(enrollment))}</td>
                <td>${formatMoney(balanceForEnrollment(enrollment))}</td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6">Aucune inscription</td></tr>`}
        </tbody>
      </table>

      <h2>Synthèse financière</h2>
      <table>
        <tbody>
          <tr><td>Scolarité due</td><td>${formatMoney(tuitionExpected)}</td></tr>
          <tr><td>Scolarité payée</td><td>${formatMoney(tuitionPaid)}</td></tr>
          <tr><td>Reste scolarité</td><td>${formatMoney(balance)}</td></tr>
          <tr><td>Frais annexes payés</td><td>${formatMoney(annexPaid)}</td></tr>
          <tr><td>Total payé</td><td><strong>${formatMoney(totalPaid)}</strong></td></tr>
        </tbody>
      </table>

      <h2>Détail par motif</h2>
      <table>
        <thead>
          <tr>
            <th>Motif</th>
            <th>Catégorie</th>
            <th>Montant payé</th>
            <th>Dernier paiement</th>
          </tr>
        </thead>
        <tbody>
          ${paymentsByMotif.map(item => `
            <tr>
              <td>${escapeHtml(item.reason)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${formatMoney(item.amount)}</td>
              <td>${formatDate(item.lastDate)}</td>
            </tr>
          `).join("") || `<tr><td colspan="4">Aucun paiement</td></tr>`}
        </tbody>
      </table>

      <h2>Historique des paiements</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Reçu</th>
            <th>Motif</th>
            <th>Catégorie</th>
            <th>Montant</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map(payment => `
            <tr>
              <td>${formatDate(payment.date)}</td>
              <td>${escapeHtml(payment.receiptNumber || "-")}</td>
              <td>${escapeHtml(payment.reason || "-")}</td>
              <td>${isTuitionPayment(payment) ? "Scolarité" : "Frais annexe"}</td>
              <td>${formatMoney(payment.amount)}</td>
              <td>${escapeHtml(payment.method || "-")}</td>
            </tr>
          `).join("") || `<tr><td colspan="6">Aucun paiement</td></tr>`}
        </tbody>
      </table>

      <h2>Notes et évaluations</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Évaluation</th>
            <th>Type</th>
            <th>Note</th>
            <th>Statut</th>
            <th>Appréciation</th>
          </tr>
        </thead>
        <tbody>
          ${studentGradeRows(student.id).map(row => `
            <tr>
              <td>${formatDate(row.date)}</td>
              <td>${escapeHtml(row.title)}</td>
              <td>${escapeHtml(row.type)}</td>
              <td>${escapeHtml(row.score)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${escapeHtml(row.needsMakeup ? "Non validé" : (row.appreciation || ""))}</td>
            </tr>
          `).join("") || `<tr><td colspan="6">Aucune note</td></tr>`}
        </tbody>
      </table>

      <p style="margin-top: 42px;">Signature et cachet</p>
    </section>
  `;
  showPrintPreview();
}

function printStudentTranscript(studentId = Number(ids.individualReportStudent?.value || 0)) {
  const student = getStudent(studentId);
  if (!student) {
    showToast("Choisissez un étudiant");
    return;
  }

  const rows = studentGradeRows(student.id);
  const scoredRows = rows.filter(row => row.score20 !== null);
  const average20 = scoredRows.length
    ? scoredRows.reduce((sum, row) => sum + Number(row.score20 || 0), 0) / scoredRows.length
    : null;
  const enrollment = state.enrollments.find(item => Number(item.studentId) === Number(student.id));
  const course = enrollment ? getCourse(enrollment.courseId) : null;
  const group = enrollment ? getGroup(enrollment.groupId) : null;

  ids.printArea.innerHTML = `
    <section class="print-document transcript-document">
      ${printHeaderHtml("Relevé de notes")}
      <table>
        <tbody>
          <tr><td>Étudiant</td><td><strong>${escapeHtml(fullName(student))}</strong></td></tr>
          <tr><td>Matricule</td><td>${escapeHtml(student.matricule || "-")}</td></tr>
          <tr><td>Formation</td><td>${escapeHtml(course?.name || "-")}</td></tr>
          <tr><td>Promotion</td><td>${escapeHtml(group?.name || "-")}</td></tr>
          <tr><td>Type de cours</td><td>${escapeHtml(groupSessionLabel(group))}</td></tr>
          <tr><td>Condition de validation</td><td>${PASSING_SCORE_20}/20 minimum par matière</td></tr>
        </tbody>
      </table>

      <div class="transcript-summary">
        <div><span>Moyenne générale</span><strong>${average20 === null ? "-" : `${average20.toFixed(2)} / 20`}</strong></div>
        <div><span>Matières évaluées</span><strong>${rows.length}</strong></div>
        <div><span>Matières validées</span><strong>${rows.filter(row => !row.needsMakeup && row.score20 !== null).length}</strong></div>
        <div><span>Matières non validées</span><strong>${rows.filter(row => row.needsMakeup).length}</strong></div>
      </div>

      <table style="margin-top: 18px;">
        <thead>
          <tr>
            <th>Date</th>
            <th>Matière / Évaluation</th>
            <th>Promotion</th>
            <th>Note</th>
            <th>Statut</th>
            <th>Appréciation</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${formatDate(row.date)}</td>
              <td>${escapeHtml(row.title)}</td>
              <td>${escapeHtml(row.groupName)}</td>
              <td>${escapeHtml(row.score)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${escapeHtml(row.needsMakeup ? "Non validé" : (row.appreciation || ""))}</td>
            </tr>
          `).join("") || `<tr><td colspan="6">Aucune note enregistrée</td></tr>`}
        </tbody>
      </table>

      <div class="print-signature-row">
        <p>Direction des études</p>
        <p>Signature et cachet</p>
      </div>
    </section>
  `;
  showPrintPreview();
}

function studentGradeRows(studentId) {
  return state.evaluations.flatMap(evaluation => {
    const grade = (evaluation.grades || []).find(item => Number(item.studentId) === Number(studentId));
    if (!grade) return [];
    const maxScore = Number(evaluation.maxScore || 20);
    const needsMakeup = gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore);
    const group = getGroup(evaluation.groupId);
    const scoreNumber = Number(grade.score);
    const makeupNumber = Number(grade.makeupScore);
    const effectiveScore = effectiveGradeScore(grade);
    return [{
      date: evaluation.date,
      title: evaluation.title,
      type: evaluation.type || "-",
      groupName: group?.name || "-",
      sessionType: groupSessionLabel(group),
      rawScore: Number.isNaN(scoreNumber) ? null : scoreNumber,
      rawMakeupScore: Number.isNaN(makeupNumber) ? null : makeupNumber,
      effectiveScore,
      maxScore,
      score20: effectiveScore === null ? null : effectiveScore * 20 / maxScore,
      score: grade.score === "" ? "-" : `${grade.score} / ${maxScore}`,
      makeupScore: grade.makeupScore ?? "",
      status: gradeStatusLabel(grade.score, maxScore, grade.makeupScore),
      needsMakeup,
      makeupFee: needsMakeup ? MAKEUP_FEE : 0,
      appreciation: grade.appreciation || ""
    }];
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function printGradesReport(evaluationId) {
  const evaluation = getEvaluation(evaluationId);
  if (!evaluation) return;
  const group = getGroup(evaluation.groupId);
  const trainer = getTrainer(evaluation.trainerId);
  const maxScore = Number(evaluation.maxScore || 20);
  const grades = Array.isArray(evaluation.grades) ? evaluation.grades : [];
  const makeup = evaluationMakeupStats(evaluation);
  ids.printArea.innerHTML = `
    <section class="print-document">
      ${printHeaderHtml("Releve de notes")}
      <table>
        <tbody>
          <tr><td>Evaluation</td><td><strong>${escapeHtml(evaluation.title)}</strong></td></tr>
          <tr><td>Promotion</td><td>${escapeHtml(group?.name || "-")}</td></tr>
          <tr><td>Type de cours</td><td>${escapeHtml(groupSessionLabel(group))}</td></tr>
          <tr><td>Formateur</td><td>${escapeHtml(trainerName(trainer))}</td></tr>
          <tr><td>Date</td><td>${formatDate(evaluation.date)}</td></tr>
          <tr><td>Moyenne</td><td>${formatAverage(evaluation)}</td></tr>
          <tr><td>Condition de validation</td><td>${PASSING_SCORE_20}/20 minimum par matière</td></tr>
          <tr><td>Matières non validées</td><td>${makeup.count} étudiant(s)</td></tr>
        </tbody>
      </table>
      <table style="margin-top: 18px;">
        <thead>
          <tr>
            <th>Matricule</th>
            <th>Étudiant</th>
            <th>Note</th>
            <th>Rattrapage</th>
            <th>Statut</th>
            <th>Appreciation</th>
          </tr>
        </thead>
        <tbody>
          ${grades.map(grade => {
            const student = getStudent(grade.studentId);
            return `
              <tr>
                <td>${escapeHtml(student?.matricule || "-")}</td>
                <td>${escapeHtml(fullName(student))}</td>
                <td>${grade.score === "" ? "-" : `${escapeHtml(grade.score)} / ${maxScore}`}</td>
                <td>${grade.makeupScore === "" || grade.makeupScore === undefined ? "-" : `${escapeHtml(grade.makeupScore)} / ${maxScore}`}</td>
                <td>${escapeHtml(gradeStatusLabel(grade.score, maxScore, grade.makeupScore))}</td>
                <td>${escapeHtml(gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore) ? "Rattrapage requis" : (grade.appreciation || ""))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      <p style="margin-top: 42px;">Signature du formateur</p>
    </section>
  `;
  showPrintPreview();
}

function exportPaymentsCsv(filename = "paiements-cfp-erexit.csv") {
  const rows = state.payments.map(payment => {
    const enrollment = getEnrollment(payment.enrollmentId);
    const student = enrollment ? getStudent(enrollment.studentId) : undefined;
    return [
      payment.receiptNumber,
      fullName(student),
      payment.amount,
      payment.method,
      payment.reason,
      isTuitionPayment(payment) ? "Scolarité" : "Frais annexe",
      payment.date
    ];
  });
  downloadCsv(filename, ["Reçu", "Étudiant", "Montant", "Mode", "Motif", "Catégorie", "Date"], rows);
}

function exportCashCsv(filename = "caisse-cfp-erexit.csv") {
  const rows = cashLedgerEntries().map(entry => [
    entry.date,
    entry.type === "income" ? "Entrée" : "Dépense",
    entry.category,
    entry.amount,
    entry.method,
    entry.description,
    entry.recordedBy,
    entry.locked ? "Automatique" : "Manuel"
  ]);
  downloadCsv(filename, ["Date", "Type", "Catégorie", "Montant", "Mode", "Description", "Saisi par", "Origine"], rows);
}

function exportStudentsCsv(filename = "etudiants-cfp-erexit.csv") {
  const rows = state.students.map(student => [
    student.matricule,
    student.lastName,
    student.firstName,
    student.phone,
    student.email,
    student.status
  ]);
  downloadCsv(filename, ["Matricule", "Nom", "Prénom", "Téléphone", "Email", "Statut"], rows);
}

function exportAllCsv() {
  const stamp = exportStamp();
  exportPaymentsCsv(`paiements-cfp-erexit-${stamp}.csv`);
  exportCashCsv(`caisse-cfp-erexit-${stamp}.csv`);
  exportStudentsCsv(`etudiants-cfp-erexit-${stamp}.csv`);
  exportEnrollmentsCsv(`inscriptions-cfp-erexit-${stamp}.csv`);
  exportStaffPaymentsCsv(`paiements-personnel-cfp-erexit-${stamp}.csv`);
  showToast("Exports CSV générés");
}

function exportEnrollmentsCsv(filename = "inscriptions-cfp-erexit.csv") {
  const rows = state.enrollments.map(enrollment => {
    const student = getStudent(enrollment.studentId);
    const course = getCourse(enrollment.courseId);
    const group = getGroup(enrollment.groupId);
    return [
      fullName(student),
      course?.name || "",
      group?.name || "",
      groupSessionLabel(group),
      enrollment.date,
      tuitionExpectedForEnrollment(enrollment),
      paidAmount(enrollment.id),
      annexPaidAmount(enrollment.id),
      balanceForEnrollment(enrollment),
      enrollment.status
    ];
  });
  downloadCsv(filename, ["Étudiant", "Formation", "Promotion", "Type de cours", "Date", "Scolarité exigible", "Scolarité payée", "Annexes payées", "Reste scolarité", "Statut"], rows);
}

function exportStaffPaymentsCsv(filename = "paiements-personnel-cfp-erexit.csv") {
  const rows = state.staffPayments.map(payment => {
    const member = getStaffMember(payment.staffId);
    return [
      payment.date,
      staffName(member),
      payment.period,
      payment.reason,
      payment.amount,
      payment.method,
      payment.note,
      payment.recordedBy
    ];
  });
  downloadCsv(filename, ["Date", "Personnel", "Période", "Motif", "Montant", "Mode", "Note", "Saisi par"], rows);
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\n");
  downloadFile(filename, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}

function exportStamp() {
  return new Date().toISOString().slice(0, 19).replaceAll(":", "").replace("T", "-");
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "CFP EREXIT Manager",
    version: "2.0.0",
    data: state
  };
  downloadFile(`cfp-erexit-sauvegarde-${exportStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const importedState = imported?.data && typeof imported.data === "object" ? imported.data : imported;
      state = { ...seedState(), ...importedState };
      saveState();
      render();
      showToast("Données importées");
    } catch {
      showToast("Fichier JSON invalide");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetData() {
  if (!confirm("Réinitialiser toutes les données locales ?")) return;
  state = seedState();
  saveState();
  render();
  showToast("Données réinitialisées");
}

window.addEventListener("error", (event) => {
  console.error("Erreur JS :", event.error);
});

bootstrap();

