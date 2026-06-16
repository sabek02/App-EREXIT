const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const LOGO_PATH = path.join(DATA_DIR, "logo.png");
const SESSION_COOKIE = "cfp_erexit_session";
const sessions = new Map();
const MAX_AUTO_BACKUPS = 30;
let dbWriteChain = Promise.resolve();
let mysqlPool = null;
let mysqlReady = false;

const ACCESS_VIEWS = [
  "dashboard",
  "onlineRequests",
  "students",
  "courses",
  "groups",
  "enrollments",
  "payments",
  "cash",
  "notifications",
  "planning",
  "announcements",
  "resources",
  "attendance",
  "trainers",
  "staff",
  "grades",
  "reports",
  "settings"
];
const MANAGED_ACCESS_VIEWS = ACCESS_VIEWS.filter(view => view !== "settings");
const TUITION_MOTIF_KEYS = ["scolarite", "formation", "mensualite"];
const MAKEUP_MOTIF_KEY = "rattrapage";
const PASSING_SCORE_20 = 12;
const MAKEUP_FEE = 5000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function legacySha256(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function bcrypt() {
  try {
    return require("bcryptjs");
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const value = String(password || "");
  const bcryptLib = bcrypt();
  if (bcryptLib) {
    return `bcrypt$${bcryptLib.hashSync(value, 12)}`;
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(value, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash = "") {
  const value = String(password || "");
  const stored = String(storedHash || "");
  if (stored.startsWith("bcrypt$")) {
    const bcryptLib = bcrypt();
    return !!bcryptLib && bcryptLib.compareSync(value, stored.slice("bcrypt$".length));
  }
  if (/^\$2[aby]\$/.test(stored)) {
    const bcryptLib = bcrypt();
    return !!bcryptLib && bcryptLib.compareSync(value, stored);
  }
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(value, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  }
  return stored.length === 64 && legacySha256(value) === stored;
}

function passwordNeedsRehash(storedHash = "") {
  const stored = String(storedHash || "");
  return !(stored.startsWith("bcrypt$") || stored.startsWith("scrypt$") || /^\$2[aby]\$/.test(stored));
}

function passwordPolicyError(password) {
  const value = String(password || "");
  const weak = new Set(["admin123", "secret123", "compta123", "formateur123", "changeme123", "123456", "password"]);
  if (value.length < 8) return "Le mot de passe doit contenir au moins 8 caractères";
  if (!/[A-Z]/.test(value)) return "Le mot de passe doit contenir au moins une majuscule";
  if (!/[a-z]/.test(value)) return "Le mot de passe doit contenir au moins une minuscule";
  if (!/\d/.test(value)) return "Le mot de passe doit contenir au moins un chiffre";
  if (!/[^A-Za-z0-9]/.test(value)) return "Le mot de passe doit contenir au moins un caractère spécial";
  if (weak.has(value.toLowerCase())) return "Ce mot de passe est trop faible";
  return "";
}

function roleCode(role = "") {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function isAdminUser(user) {
  const code = roleCode(user?.role);
  return code === "administrateur" || code === "admin";
}

function withDbWriteLock(task) {
  const run = dbWriteChain.then(() => withStorageWriteLock(task), () => withStorageWriteLock(task));
  dbWriteChain = run.catch(() => {});
  return run;
}

async function withStorageWriteLock(task) {
  if (!isMysqlStorage()) return task();
  const pool = await getMysqlPool();
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute("SELECT GET_LOCK('cfp_erexit_db_write', 15) AS locked");
    if (Number(rows[0]?.locked) !== 1) {
      throw new Error("Impossible d'obtenir le verrou de sauvegarde MySQL");
    }
    return await task();
  } finally {
    await connection.execute("SELECT RELEASE_LOCK('cfp_erexit_db_write')").catch(() => {});
    connection.release();
  }
}

function mysqlConfig() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || "";
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      database: parsed.pathname.replace(/^\//, ""),
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: false,
      charset: "utf8mb4"
    };
  }

  const host = process.env.MYSQL_HOST || process.env.DB_HOST || "";
  const database = process.env.MYSQL_DATABASE || process.env.DB_NAME || "";
  const user = process.env.MYSQL_USER || process.env.DB_USER || "";
  if (!host || !database || !user) return null;
  return {
    host,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user,
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "",
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    namedPlaceholders: false,
    charset: "utf8mb4"
  };
}

function isMysqlStorage() {
  return !!mysqlConfig();
}

async function getMysqlPool() {
  if (mysqlPool) return mysqlPool;
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("Le module mysql2 est requis pour utiliser MySQL. Lancez npm install sur l'hebergeur.");
  }
  mysqlPool = mysql.createPool(mysqlConfig());
  return mysqlPool;
}

function permissionsForUser(user) {
  if (isAdminUser(user)) return [...ACCESS_VIEWS];
  const permissions = Array.isArray(user?.permissions) && user.permissions.length
    ? user.permissions
    : defaultPermissionsForRole(user?.role);
  return permissions.filter(view => MANAGED_ACCESS_VIEWS.includes(view));
}

const collectionWritePermissions = {
  center: "settings",
  academicSettings: "settings",
  securitySettings: "settings",
  paymentMotifs: "settings",
  documentTemplates: "settings",
  requiredDocuments: "settings",
  users: "settings",
  onlineRegistrationRequests: "students",
  studentAccounts: "students",
  onlinePayments: "payments",
  notifications: "students",
  planningEvents: "planning",
  announcements: "announcements",
  rooms: "resources",
  equipment: "resources",
  students: "students",
  courses: "courses",
  groups: "groups",
  enrollments: "enrollments",
  payments: "payments",
  paymentAuditLog: "payments",
  passwordResetRequests: "settings",
  cashEntries: "cash",
  staffPayments: "staff",
  attendanceSessions: "attendance",
  trainerAttendanceSessions: "attendance",
  trainers: "trainers",
  staffMembers: "staff",
  evaluations: "grades"
};

const collectionReadViews = {
  onlineRegistrationRequests: "onlineRequests",
  studentAccounts: "students",
  notifications: "students",
  students: "students",
  courses: "courses",
  groups: "groups",
  enrollments: "enrollments",
  onlinePayments: "payments",
  payments: "payments",
  planningEvents: "planning",
  announcements: "announcements",
  rooms: "resources",
  equipment: "resources",
  paymentAuditLog: "payments",
  cashEntries: "cash",
  staffPayments: "staff",
  attendanceSessions: "attendance",
  trainerAttendanceSessions: "attendance",
  trainers: "trainers",
  staffMembers: "staff",
  evaluations: "grades",
  passwordResetRequests: "settings",
  loginHistory: "settings",
  auditLog: "settings"
};

const collectionWriteRoles = {
  center: ["Administrateur"],
  academicSettings: ["Administrateur"],
  securitySettings: ["Administrateur"],
  paymentMotifs: ["Administrateur", "Comptable"],
  documentTemplates: ["Administrateur"],
  requiredDocuments: ["Administrateur", "Secrétaire"],
  users: ["Administrateur"],
  onlineRegistrationRequests: ["Administrateur", "Directeur", "Secrétaire", "Accueil"],
  studentAccounts: ["Administrateur", "Secrétaire"],
  onlinePayments: ["Administrateur", "Comptable"],
  notifications: ["Administrateur", "Directeur", "Secrétaire", "Comptable", "Formateur", "Accueil"],
  planningEvents: ["Administrateur", "Directeur", "Secrétaire", "Formateur", "Accueil"],
  announcements: ["Administrateur", "Directeur", "Secrétaire", "Accueil"],
  rooms: ["Administrateur", "Directeur", "Secrétaire"],
  equipment: ["Administrateur", "Directeur", "Secrétaire"],
  students: ["Administrateur", "Directeur", "Secrétaire", "Accueil"],
  courses: ["Administrateur", "Directeur"],
  groups: ["Administrateur", "Directeur", "Secrétaire"],
  enrollments: ["Administrateur", "Directeur", "Secrétaire"],
  payments: ["Administrateur", "Comptable"],
  paymentAuditLog: ["Administrateur", "Comptable"],
  passwordResetRequests: ["Administrateur"],
  cashEntries: ["Administrateur", "Comptable"],
  staffPayments: ["Administrateur", "Comptable"],
  attendanceSessions: ["Administrateur", "Secrétaire", "Formateur"],
  trainerAttendanceSessions: ["Administrateur", "Secrétaire"],
  trainers: ["Administrateur", "Directeur"],
  staffMembers: ["Administrateur", "Directeur"],
  evaluations: ["Administrateur", "Formateur"]
};

function canWriteCollection(user, collection) {
  if (isAdminUser(user)) return true;
  const allowedRoles = collectionWriteRoles[collection];
  const currentRole = roleCode(user?.role);
  return Array.isArray(allowedRoles) && allowedRoles.some(role => roleCode(role) === currentRole);
}

function canReadCollection(user, collection) {
  if (isAdminUser(user)) return true;
  const view = collectionReadViews[collection] || collectionWritePermissions[collection];
  return !view || permissionsForUser(user).includes(view);
}

function isRedactedCollectionSubmission(previous, submitted, user, collection) {
  return !canReadCollection(user, collection) &&
    Array.isArray(submitted?.[collection]) &&
    submitted[collection].length === 0 &&
    Array.isArray(previous?.[collection]) &&
    previous[collection].length > 0;
}

function isPublicCenterSubmission(previous, submitted, collection) {
  if (collection !== "center" || !submitted?.center || !previous?.center) return false;
  const submittedCenter = { ...submitted.center };
  if (String(submittedCenter.logoData || "").startsWith("/api/logo")) {
    submittedCenter.logoData = previous.center.logoData || "";
  }
  return stableJson(submittedCenter) === stableJson(previous.center);
}

function isReadonlyAcademicSettingsSubmission(user, collection) {
  return collection === "academicSettings" && !canWriteCollection(user, collection);
}

function isReadonlySecuritySettingsSubmission(user, collection) {
  return collection === "securitySettings" && !canWriteCollection(user, collection);
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function forbiddenStateChanges(previous, submitted, user) {
  if (isAdminUser(user)) return [];
  return Object.entries(collectionWritePermissions)
    .filter(([collection, permission]) => Object.prototype.hasOwnProperty.call(submitted, collection)
      && stableJson(submitted[collection]) !== stableJson(previous[collection])
      && !isRedactedCollectionSubmission(previous, submitted, user, collection)
      && !isPublicCenterSubmission(previous, submitted, collection)
      && !isReadonlyAcademicSettingsSubmission(user, collection)
      && !isReadonlySecuritySettingsSubmission(user, collection)
      && !canWriteCollection(user, collection))
    .map(([collection]) => collection);
}

function defaultDb() {
  return {
    center: {
      name: "CFP EREXIT",
      subtitle: "Centre de Formation Professionnelle",
      phone: "",
      email: "",
      logoData: "",
      stampData: "",
      address: ""
    },
    academicSettings: {
      activeYear: String(new Date().getFullYear()),
      archivedYears: []
    },
    securitySettings: {
      idleTimeoutMinutes: 30
    },
    paymentMotifs: [
      { key: "scolarite", label: "Scolarité", amount: 0 },
      { key: "inscription", label: "Inscription", amount: 15000 },
      { key: "document", label: "Document", amount: 5000 },
      { key: "tenue", label: "Tenue", amount: 25000 },
      { key: "tshirt", label: "T-shirt", amount: 5000 },
      { key: "macaron", label: "Macaron", amount: 2000 },
      { key: MAKEUP_MOTIF_KEY, label: "Rattrapage", amount: MAKEUP_FEE }
    ],
    documentTemplates: [],
    users: [
      {
        id: 1,
        name: "Administrateur CFP EREXIT",
        username: "admin",
        email: "admin@cftperexit.com",
        passwordHash: hashPassword("admin123"),
        role: "Administrateur",
        status: "active",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        permissions: [...ACCESS_VIEWS]
      },
      {
        id: 2,
        name: "Secrétariat",
        username: "secretariat",
        email: "secretariat@cftperexit.com",
        passwordHash: hashPassword("secret123"),
        role: "Secrétaire",
        status: "active",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        permissions: defaultPermissionsForRole("Secrétaire")
      },
      {
        id: 3,
        name: "Comptabilité",
        username: "comptable",
        email: "comptable@cftperexit.com",
        passwordHash: hashPassword("compta123"),
        role: "Comptable",
        status: "active",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        permissions: defaultPermissionsForRole("Comptable")
      },
      {
        id: 4,
        name: "Formateur",
        username: "formateur",
        email: "formateur@cftperexit.com",
        passwordHash: hashPassword("formateur123"),
        role: "Formateur",
        status: "active",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        permissions: defaultPermissionsForRole("Formateur")
      }
    ],
    passwordResetRequests: [],
    onlineRegistrationRequests: [],
    studentAccounts: [],
    onlinePayments: [],
    notifications: [],
    planningEvents: [],
    announcements: [],
    rooms: [],
    equipment: [],
    loginHistory: [],
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
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username || "",
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: !!user.mustChangePassword,
    permissions: permissionsForUser(user)
  };
}

function publicManagedUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username || "",
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: !!user.mustChangePassword,
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    lastLoginAt: user.lastLoginAt || "",
    permissions: permissionsForUser(user)
  };
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

function knownDefaultPassword(user = {}) {
  return "";
}

function canReadView(user, view) {
  return isAdminUser(user) || permissionsForUser(user).includes(view);
}

function redactStateForPermissions(state, user) {
  if (isAdminUser(user)) return state;
  const can = view => canReadView(user, view);
  const redacted = { ...state };

  if (!can("onlineRequests")) redacted.onlineRegistrationRequests = [];
  if (!can("students")) {
    redacted.students = [];
    redacted.studentAccounts = [];
    redacted.notifications = [];
  }
  if (!can("courses")) redacted.courses = [];
  if (!can("groups")) redacted.groups = [];
  if (!can("enrollments")) redacted.enrollments = [];
  if (!can("payments")) {
    redacted.payments = [];
    redacted.paymentAuditLog = [];
    redacted.onlinePayments = [];
  }
  if (!can("cash")) redacted.cashEntries = [];
  if (!can("notifications")) redacted.notifications = [];
  if (!can("planning")) redacted.planningEvents = [];
  if (!can("announcements")) redacted.announcements = [];
  if (!can("resources")) {
    redacted.rooms = [];
    redacted.equipment = [];
  }
  if (!can("attendance")) {
    redacted.attendanceSessions = [];
    redacted.trainerAttendanceSessions = [];
  }
  if (!can("trainers")) redacted.trainers = [];
  if (!can("staff")) {
    redacted.staffMembers = [];
    redacted.staffPayments = [];
  }
  if (!can("grades")) redacted.evaluations = [];
  if (!can("settings")) {
    redacted.passwordResetRequests = [];
    redacted.loginHistory = [];
    redacted.auditLog = [];
  }
  return redacted;
}

function publicState(db, user = null) {
  const { users, ...state } = db;
  if (state.center?.logoData) {
    state.center = {
      ...state.center,
      logoData: `/api/logo?v=${encodeURIComponent(String(db.updatedAt || Date.now()))}`
    };
  }
  if (isAdminUser(user)) {
    state.users = users.map(publicManagedUser);
  }
  return redactStateForPermissions(state, user);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneMatches(input, stored) {
  const submitted = normalizeDigits(input);
  const expected = normalizeDigits(stored);
  if (!submitted || !expected) return false;
  return submitted === expected
    || (submitted.length >= 6 && expected.endsWith(submitted))
    || (expected.length >= 6 && submitted.endsWith(expected));
}

function fullName(student) {
  if (!student) return "Etudiant";
  return `${String(student.lastName || "").toUpperCase()} ${student.firstName || ""}`.trim();
}

function groupSessionLabel(group) {
  const type = String(group?.sessionType || "jour");
  if (type === "soir") return "Cours du soir";
  if (type === "ligne") return "Cours en ligne";
  return "Cours du jour";
}

function nextId(collection = []) {
  return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function yearFromDate(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
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

function randomFiveDigits() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function generateMatricule(db, year = new Date().getFullYear()) {
  let matricule = "";
  do {
    matricule = `ERX-${year}-${randomFiveDigits()}`;
  } while ((db.students || []).some(student => student.matricule === matricule));
  return matricule;
}

function courseCost(course) {
  return Number(course?.trainingFee || 0);
}

function isTuitionPayment(payment) {
  const key = String(payment.reasonKey || "").toLowerCase();
  if (TUITION_MOTIF_KEYS.includes(key)) return true;
  const reason = normalizeSearchText(payment.reason);
  return ["scolarite", "frais de scolarite", "formation", "frais formation", "frais de formation", "mensualite"]
    .includes(reason);
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

function personDocumentCompletion(db, person, kind) {
  const required = normalizeRequiredDocuments(db.requiredDocuments)[kind] || [];
  if (!required.length) return { completed: true, missing: [] };
  const docs = Array.isArray(person?.documents) ? person.documents : [];
  const missing = required.filter(label => {
    const normalized = normalizeSearchText(label);
    if (normalized.includes("photo") && person?.photoData) return false;
    return !docs.some(documentItem => documentLabelMatchesRequirement(documentItem, label));
  });
  return { completed: missing.length === 0, missing };
}

function isDesistedEnrollment(db, enrollment) {
  const student = db.students.find(item => Number(item.id) === Number(enrollment?.studentId));
  return String(enrollment?.status || "").toLowerCase() === "desiste" ||
    String(student?.status || "").toLowerCase() === "desiste";
}

function discountedCopiedTuition(enrollment, copiedFees) {
  const tuitionFees = copiedFees.filter(fee => String(fee?.category || "") === "scolarite" || fee?.includedInTuition);
  if (!tuitionFees.length) return Number(enrollment?.finalAmount ?? 0);
  const enrollmentTotal = Number(enrollment?.totalAmount ?? 0);
  const copiedOriginalTotal = tuitionFees.reduce((sum, fee) => sum + Number(fee.amountOriginal ?? fee.amount ?? fee.amountFinal ?? 0), 0);
  if (enrollmentTotal > 0 && Math.abs(copiedOriginalTotal - enrollmentTotal) >= 1) {
    return Math.max(0, enrollmentTotal - Number(enrollment?.discountAmount || 0));
  }
  let remainingDiscount = Number(enrollment?.discountAmount || 0);
  return tuitionFees.reduce((sum, fee) => {
    const original = Number(fee.amountOriginal ?? fee.amount ?? 0);
    const discount = Math.min(original, Math.max(0, remainingDiscount));
    remainingDiscount -= discount;
    return sum + Math.max(0, original - discount);
  }, 0);
}

function tuitionExpectedForEnrollment(db, enrollment) {
  const status = String(enrollment?.status || "").toLowerCase();
  if (["annulee", "desiste"].includes(status) || isDesistedEnrollment(db, enrollment)) return 0;
  const copiedFees = Array.isArray(enrollment?.copiedFees) ? enrollment.copiedFees : [];
  return copiedFees.some(fee => String(fee?.category || "") === "scolarite" || fee?.includedInTuition)
    ? discountedCopiedTuition(enrollment, copiedFees)
    : Number(enrollment?.finalAmount ?? 0);
}

function studentPortalPayload(db, student) {
  const studentEnrollments = db.enrollments
    .filter(enrollment => Number(enrollment.studentId) === Number(student.id))
    .map(enrollment => {
      const course = db.courses.find(item => Number(item.id) === Number(enrollment.courseId));
      const group = db.groups.find(item => Number(item.id) === Number(enrollment.groupId));
      const enrollmentPayments = db.payments.filter(payment => Number(payment.enrollmentId) === Number(enrollment.id));
      const tuitionPaid = enrollmentPayments
        .filter(isTuitionPayment)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const annexPaid = enrollmentPayments
        .filter(payment => !isTuitionPayment(payment))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const finalAmount = tuitionExpectedForEnrollment(db, enrollment);

      return {
        id: enrollment.id,
        date: enrollment.date || "",
        status: enrollment.status || "",
        courseName: course?.name || "",
        courseCode: course?.code || "",
        groupName: group?.name || "",
        sessionType: groupSessionLabel(group),
        finalAmount,
        tuitionPaid,
        annexPaid,
        balance: Math.max(0, finalAmount - tuitionPaid)
      };
    });

  const enrollmentIds = new Set(studentEnrollments.map(enrollment => Number(enrollment.id)));
  const payments = db.payments
    .filter(payment => enrollmentIds.has(Number(payment.enrollmentId)))
    .map(payment => ({
      id: payment.id,
      receiptNumber: payment.receiptNumber || "",
      amount: Number(payment.amount || 0),
      method: payment.method || "",
      reason: payment.reason || "",
      reasonKey: payment.reasonKey || "",
      category: isTuitionPayment(payment) ? "Scolarite" : "Frais annexe",
      date: payment.date || ""
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id));

  const grades = db.evaluations.flatMap(evaluation => {
    const grade = (evaluation.grades || []).find(item => Number(item.studentId) === Number(student.id));
    if (!grade) return [];
    const group = db.groups.find(item => Number(item.id) === Number(evaluation.groupId));
    const maxScore = Number(evaluation.maxScore || 20);
    const needsMakeup = gradeNeedsMakeup(grade.score, maxScore, grade.makeupScore);
    const effectiveScore = effectiveGradeScore(grade);
    return [{
      id: evaluation.id,
      date: evaluation.date || "",
      title: evaluation.title || "",
      type: evaluation.type || "",
      groupName: group?.name || "",
      sessionType: groupSessionLabel(group),
      maxScore,
      score: grade.score === "" || grade.score === undefined ? "" : grade.score,
      makeupScore: grade.makeupScore === "" || grade.makeupScore === undefined ? "" : grade.makeupScore,
      effectiveScore,
      status: gradeStatusLabel(grade.score, maxScore, grade.makeupScore),
      needsMakeup,
      makeupFee: needsMakeup ? MAKEUP_FEE : 0,
      appreciation: grade.appreciation || ""
    }];
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const attendance = db.attendanceSessions.flatMap(session => {
    const record = (session.records || []).find(item => Number(item.studentId) === Number(student.id));
    if (!record) return [];
    const group = db.groups.find(item => Number(item.id) === Number(session.groupId));
    return [{
      id: session.id,
      date: session.date || "",
      topic: session.topic || "",
      groupName: group?.name || "",
      sessionType: groupSessionLabel(group),
      status: record.status || ""
    }];
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const groupIds = new Set(studentEnrollments.map(enrollment => Number(enrollment.groupId)).filter(Boolean));
  const todayValue = new Date().toISOString().slice(0, 10);
  const announcements = (db.announcements || [])
    .filter(announcement => String(announcement.status || "published") === "published")
    .filter(announcement => !announcement.expiryDate || String(announcement.expiryDate).slice(0, 10) >= todayValue)
    .filter(announcement => {
      const audience = String(announcement.audience || "all");
      if (audience === "all" || audience === "students") return true;
      if (audience === "group") return groupIds.has(Number(announcement.groupId));
      return false;
    })
    .map(announcement => ({
      id: announcement.id,
      title: announcement.title || "",
      message: announcement.message || "",
      priority: announcement.priority || "info",
      audience: announcement.audience || "all",
      groupId: announcement.groupId || 0,
      date: announcement.date || announcement.createdAt || "",
      expiryDate: announcement.expiryDate || ""
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    center: {
      name: db.center?.name || "CFP EREXIT",
      subtitle: db.center?.subtitle || "",
      phone: db.center?.phone || "",
      email: db.center?.email || "",
      address: db.center?.address || ""
    },
    student: {
      id: student.id,
      matricule: student.matricule || "",
      firstName: student.firstName || "",
      lastName: student.lastName || "",
      fullName: fullName(student),
      gender: student.gender || "",
      birthDate: student.birthDate || "",
      phone: student.phone || "",
      email: student.email || "",
      address: student.address || "",
      emergencyName: student.emergencyName || "",
      emergencyPhone: student.emergencyPhone || "",
      status: student.status || "",
      photoData: student.photoData || "",
      documents: Array.isArray(student.documents)
        ? student.documents.map(documentItem => ({
            type: documentItem.type || "",
            name: documentItem.name || "",
            originalName: documentItem.originalName || "",
            size: Number(documentItem.size || 0),
            url: documentItem.url || "",
            data: documentItem.data || ""
          }))
        : [],
      documentCompletion: personDocumentCompletion(db, student, "student")
    },
    enrollments: studentEnrollments,
    payments,
    onlinePayments: (db.onlinePayments || [])
      .filter(payment => Number(payment.studentId) === Number(student.id))
      .map(payment => ({
        id: payment.id,
        enrollmentId: payment.enrollmentId,
        referenceTransaction: payment.referenceTransaction || "",
        motif: payment.motif || "",
        category: payment.category || "",
        amount: Number(payment.amount || 0),
        provider: payment.provider || "",
        status: payment.status || "",
        initiatedAt: payment.initiatedAt || "",
        confirmedAt: payment.confirmedAt || ""
      }))
      .sort((a, b) => String(b.initiatedAt).localeCompare(String(a.initiatedAt))),
    notifications: (db.notifications || [])
      .filter(notification => notification.audience === "student" && Number(notification.studentId) === Number(student.id))
      .map(notification => ({
        id: notification.id,
        type: notification.type || "",
        title: notification.title || "",
        message: notification.message || "",
        status: notification.status || "",
        createdAt: notification.createdAt || ""
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    announcements,
    grades,
    attendance
  };
}

function normalizeBase64DataUrl(value) {
  const logo = String(value || "").trim();
  const match = logo.match(/^(data:image\/[a-zA-Z0-9.+-]+;base64,)(.+)$/);
  if (!match) return "";
  let payload = match[2].replace(/\s+/g, "").replace(/=+$/g, "");
  while (payload.length % 4 === 1) {
    payload = payload.slice(0, -1);
  }
  const padding = ["", "", "==", "="][payload.length % 4];
  return `${match[1]}${payload}${padding}`;
}

async function syncLogoFile(db) {
  if (db.center && db.center.logoData === "") {
    await fs.unlink(LOGO_PATH).catch(() => {});
    return;
  }
  const logo = normalizeBase64DataUrl(db.center?.logoData);
  if (!logo) return;
  const payload = logo.replace(/^data:[^,]+,/, "");
  await fs.writeFile(LOGO_PATH, Buffer.from(payload, "base64"));
}

async function ensureDb() {
  if (isMysqlStorage()) {
    await ensureMysqlDb();
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await writeDb(defaultDb());
  }
}

async function ensureMysqlDb() {
  if (mysqlReady) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const pool = await getMysqlPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cfp_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      data LONGTEXT NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      updated_by VARCHAR(190) NOT NULL DEFAULT '',
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
      CONSTRAINT cfp_state_json CHECK (JSON_VALID(data))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cfp_state_revisions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      state_id TINYINT UNSIGNED NOT NULL,
      revision BIGINT UNSIGNED NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      updated_by VARCHAR(190) NOT NULL DEFAULT '',
      data LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cfp_state_revisions_state_revision (state_id, revision),
      CONSTRAINT cfp_state_revisions_json CHECK (JSON_VALID(data))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await pool.execute("SELECT id FROM cfp_state WHERE id = 1 LIMIT 1");
  if (!rows.length) {
    let initial = defaultDb();
    try {
      const raw = await fs.readFile(DB_PATH, "utf8");
      initial = { ...initial, ...JSON.parse(cleanJsonText(raw)) };
    } catch {}
    initial = repairEncodingIssues(initial);
    initial.users = normalizeLoadedUsers(Array.isArray(initial.users) && initial.users.length ? initial.users : defaultDb().users);
    initial.updatedAt ||= new Date().toISOString();
    initial.updatedBy ||= "migration-json";
    const payload = JSON.stringify(initial);
    await pool.execute(
      "INSERT INTO cfp_state (id, data, updated_at, updated_by, revision) VALUES (1, ?, ?, ?, 1)",
      [payload, String(initial.updatedAt), String(initial.updatedBy || "")]
    );
    await pool.execute(
      "INSERT INTO cfp_state_revisions (state_id, revision, updated_at, updated_by, data) VALUES (1, 1, ?, ?, ?)",
      [String(initial.updatedAt), String(initial.updatedBy || ""), payload]
    );
  }
  mysqlReady = true;
}

function parseStoredState(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  return JSON.parse(cleanJsonText(String(value)));
}

function normalizeDbState(db) {
  const defaults = defaultDb();
  const next = repairEncodingIssues({
    ...defaults,
    ...db,
    users: Array.isArray(db.users) && db.users.length ? db.users : defaults.users
  });
  next.users = normalizeLoadedUsers(next.users);
  next.academicSettings = normalizeAcademicSettings(next.academicSettings);
  next.securitySettings = normalizeSecuritySettings(next.securitySettings);
  next.onlineRegistrationRequests = Array.isArray(next.onlineRegistrationRequests) ? next.onlineRegistrationRequests : [];
  next.studentAccounts = Array.isArray(next.studentAccounts) ? next.studentAccounts : [];
  next.onlinePayments = Array.isArray(next.onlinePayments) ? next.onlinePayments : [];
  next.notifications = Array.isArray(next.notifications) ? next.notifications : [];
  next.planningEvents = Array.isArray(next.planningEvents) ? next.planningEvents : [];
  next.announcements = Array.isArray(next.announcements) ? next.announcements : [];
  next.rooms = Array.isArray(next.rooms) ? next.rooms : [];
  next.equipment = Array.isArray(next.equipment) ? next.equipment : [];
  next.trainers = Array.isArray(next.trainers)
    ? next.trainers.map(trainer => ({ ...trainer, email: migrateEmailDomain(trainer.email) }))
    : [];
  next.passwordResetRequests = Array.isArray(next.passwordResetRequests) ? next.passwordResetRequests : [];
  next.loginHistory = Array.isArray(next.loginHistory) ? next.loginHistory : [];
  next.auditLog = Array.isArray(next.auditLog) ? next.auditLog : [];
  next.requiredDocuments = normalizeRequiredDocuments(next.requiredDocuments);
  next.documentTemplates = Array.isArray(next.documentTemplates) ? next.documentTemplates : [];
  next.groups = Array.isArray(next.groups) ? next.groups.map(group => ({
    ...group,
    sessionType: group.sessionType || "jour"
  })) : [];
  return next;
}

async function readDb() {
  await ensureDb();
  if (isMysqlStorage()) {
    const pool = await getMysqlPool();
    const [rows] = await pool.execute("SELECT data FROM cfp_state WHERE id = 1 LIMIT 1");
    if (!rows.length) return normalizeDbState(defaultDb());
    return normalizeDbState(parseStoredState(rows[0].data));
  }
  const raw = await fs.readFile(DB_PATH, "utf8");
  const db = JSON.parse(cleanJsonText(raw));
  return normalizeDbState(db);
}

function normalizeRequiredDocuments(value = {}) {
  const defaults = defaultDb().requiredDocuments;
  return {
    student: Array.isArray(value.student) && value.student.length ? value.student : defaults.student,
    trainer: Array.isArray(value.trainer) && value.trainer.length ? value.trainer : defaults.trainer,
    staff: Array.isArray(value.staff) && value.staff.length ? value.staff : defaults.staff
  };
}

function cleanJsonText(raw) {
  return String(raw || "").replace(/^\uFEFF/, "").replace(/^Ã¯Â»Â¿/, "");
}

function normalizeLoadedUsers(users) {
  return users.map((user, index) => {
    const role = user.role || (index === 0 ? "Administrateur" : "Secrétaire");
    const createdAt = user.createdAt || user.updatedAt || new Date().toISOString();
    const roleDefaults = defaultPermissionsForRole(role);
    const existingPermissions = Array.isArray(user.permissions) ? user.permissions : [];
    return {
      ...user,
      id: Number(user.id || index + 1),
      username: normalizeUsername(user.username || String(user.email || "").split("@")[0] || user.name || `user-${index + 1}`),
      email: migrateEmailDomain(user.email),
      password: undefined,
      visiblePassword: undefined,
      passwordHash: user.passwordHash || hashPassword(String(user.password || "")),
      role,
      status: index === 0 || isAdminUser({ role }) ? "active" : (user.status || "active"),
      mustChangePassword: !!user.mustChangePassword || !user.passwordHash || passwordNeedsRehash(user.passwordHash),
      createdAt,
      updatedAt: user.updatedAt || createdAt,
      lastLoginAt: user.lastLoginAt || "",
      permissions: isAdminUser({ role })
        ? [...ACCESS_VIEWS]
        : [...new Set([...roleDefaults, ...existingPermissions])]
          .filter(view => MANAGED_ACCESS_VIEWS.includes(view))
    };
  });
}

function migrateEmailDomain(email) {
  return String(email || "").replace(/@erexit\.local$/i, "@cftperexit.com");
}

function repairEncodingIssues(value) {
  if (Array.isArray(value)) {
    return value.map(repairEncodingIssues);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, repairEncodingIssues(entry)])
    );
  }
  if (typeof value !== "string") return value;

  const replacements = [
    ["ÃƒÂ©", "é"], ["ÃƒÂ¨", "è"], ["ÃƒÂª", "ê"], ["ÃƒÂ«", "ë"],
    ["ÃƒÂ ", "à"], ["ÃƒÂ¢", "â"], ["ÃƒÂ´", "ô"], ["ÃƒÂ¹", "ù"],
    ["ÃƒÂ»", "û"], ["ÃƒÂ§", "ç"], ["Ãƒâ€°", "É"], ["Ãƒâ‚¬", "À"],
    ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"], ["Ã«", "ë"],
    ["Ã ", "à"], ["Ã¢", "â"], ["Ã´", "ô"], ["Ã¹", "ù"],
    ["Ã»", "û"], ["Ã§", "ç"], ["Ã‰", "É"], ["Ã€", "À"],
    ["Â·", "·"], ["Â°", "°"], ["â€™", "'"], ["â€˜", "'"],
    ["â€œ", "\""], ["â€", "\""], ["â€“", "-"], ["â€”", "-"],
    ["Esp?ce", "Espèce"], ["Mensualit?", "Mensualité"], ["Mat?riel", "Matériel"], ["syst?mes", "systèmes"],
    ["r?seaux", "réseaux"], ["d?pannage", "dépannage"], ["Comptabilit?", "Comptabilité"], ["sangu?ra", "sanguéra"],
    ["Scolarit?", "Scolarité"], ["Adidogom? douane", "Adidogomé douane"],
    ["Secrï¿½taire", "Secrétaire"]
  ];

  return replacements.reduce((text, [from, to]) => text.split(from).join(to), value);
}

async function writeDb(db) {
  if (isMysqlStorage()) {
    await ensureMysqlDb();
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("SELECT id FROM cfp_state WHERE id = 1 FOR UPDATE");
      const cleanDb = repairEncodingIssues(db);
      await sanitizeUploadedFiles(cleanDb);
      const payload = JSON.stringify(cleanDb);
      await connection.execute(
        "UPDATE cfp_state SET data = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = 1",
        [payload, String(cleanDb.updatedAt || new Date().toISOString()), String(cleanDb.updatedBy || "")]
      );
      const [rows] = await connection.execute("SELECT revision FROM cfp_state WHERE id = 1 LIMIT 1");
      const revision = Number(rows[0]?.revision || 1);
      await connection.execute(
        "INSERT INTO cfp_state_revisions (state_id, revision, updated_at, updated_by, data) VALUES (1, ?, ?, ?, ?)",
        [revision, String(cleanDb.updatedAt || ""), String(cleanDb.updatedBy || ""), payload]
      );
      await connection.commit();
      await syncLogoFile(cleanDb).catch(() => {});
      return;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const cleanDb = repairEncodingIssues(db);
  await sanitizeUploadedFiles(cleanDb);
  await fs.writeFile(DB_PATH, JSON.stringify(cleanDb, null, 2), "utf8");
  await syncLogoFile(cleanDb).catch(() => {});
}

function safeUploadName(name = "fichier") {
  const extension = path.extname(String(name || "")).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".bin";
  const base = path.basename(String(name || "fichier"), extension)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "fichier";
  return `${base}${extension}`;
}

const allowedUploadMimes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const allowedUploadExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx"]);

function validateUpload({ mime, name, size }) {
  const extension = path.extname(String(name || "")).toLowerCase();
  if (!allowedUploadMimes.has(String(mime || "").toLowerCase())) return "Type de fichier non autorisé";
  if (!allowedUploadExtensions.has(extension)) return "Extension de fichier non autorisée";
  if (Number(size || 0) > 8 * 1024 * 1024) return "Fichier trop lourd";
  return "";
}

function parseDataUrl(value = "") {
  const match = String(value).match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return {
    mime: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64")
  };
}

async function saveUploadFromDataUrl({ dataUrl, name, folder = "documents" }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return "";
  const uploadError = validateUpload({ mime: parsed.mime, name, size: parsed.buffer.length });
  if (uploadError) throw new Error(uploadError);
  const now = new Date();
  const dateFolder = now.toISOString().slice(0, 10);
  const targetDir = path.join(UPLOAD_DIR, folder, dateFolder);
  await fs.mkdir(targetDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeUploadName(name)}`;
  await fs.writeFile(path.join(targetDir, filename), parsed.buffer);
  return `/uploads/${folder}/${dateFolder}/${filename}`;
}

async function sanitizePersonUploads(person, folder) {
  if (!person || typeof person !== "object") return;
  if (String(person.photoData || "").startsWith("data:")) {
    person.photoData = await saveUploadFromDataUrl({
      dataUrl: person.photoData,
      name: `${person.firstName || person.name || "photo"}-${person.lastName || ""}.png`,
      folder: `${folder}/photos`
    });
  }
  person.documents = Array.isArray(person.documents) ? person.documents : [];
  for (const documentItem of person.documents) {
    if (String(documentItem.data || "").startsWith("data:")) {
      documentItem.url = await saveUploadFromDataUrl({
        dataUrl: documentItem.data,
        name: documentItem.name || "document",
        folder: `${folder}/documents`
      });
      delete documentItem.data;
    }
  }
}

async function sanitizeUploadedFiles(db) {
  await Promise.all([
    ...(Array.isArray(db.students) ? db.students.map(item => sanitizePersonUploads(item, "students")) : []),
    ...(Array.isArray(db.trainers) ? db.trainers.map(item => sanitizePersonUploads(item, "trainers")) : []),
    ...(Array.isArray(db.staffMembers) ? db.staffMembers.map(item => sanitizePersonUploads(item, "staff")) : [])
  ]);
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeAutoBackup(db) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const filename = `cfp-erexit-backup-${backupStamp()}.json`;
  await fs.writeFile(path.join(BACKUP_DIR, filename), JSON.stringify(db, null, 2), "utf8");
  const files = (await fs.readdir(BACKUP_DIR))
    .filter(file => file.endsWith(".json"))
    .sort();
  const oldFiles = files.slice(0, Math.max(0, files.length - MAX_AUTO_BACKUPS));
  await Promise.all(oldFiles.map(file => fs.unlink(path.join(BACKUP_DIR, file)).catch(() => {})));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function parseCookies(request) {
  const cookies = {};
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key) {
      cookies[key] = decodeURIComponent(value.join("="));
    }
  }
  return cookies;
}

async function currentUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  const db = await readDb();
  const idleTimeoutMs = normalizeSecuritySettings(db.securitySettings).idleTimeoutMinutes * 60 * 1000;
  const lastActivity = Number(session.lastActivity || session.createdAt || 0);
  if (idleTimeoutMs > 0 && Date.now() - lastActivity > idleTimeoutMs) {
    sessions.delete(token);
    return null;
  }
  session.lastActivity = Date.now();
  const user = db.users.find(item => item.id === session.userId && item.status === "active");
  return user || null;
}

async function requireUser(request, response) {
  const user = await currentUser(request);
  if (!user) {
    sendError(response, 401, "Connexion requise");
    return null;
  }
  return user;
}

function isSecureRequest(request) {
  const forced = String(process.env.COOKIE_SECURE || "").trim();
  if (forced === "1") return true;
  if (forced === "0") return false;

  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;
  if (forwardedProto === "http") return false;

  return Boolean(request?.socket?.encrypted);
}

function clearCookie(request) {
  const secure = isSecureRequest(request);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function sessionCookie(token, request) {
  const secure = isSecureRequest(request);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 60 * 60}${secure ? "; Secure" : ""}`;
}

function normalizeManagedUsers(submittedUsers, previousUsers) {
  const previousById = new Map(previousUsers.map(user => [Number(user.id), user]));
  const nextUsers = [];
  let nextId = Math.max(0, ...previousUsers.map(user => Number(user.id) || 0));

  submittedUsers.forEach((submitted, index) => {
    const existing = previousById.get(Number(submitted.id));
    const isExistingAdmin = isAdminUser(existing) || index === 0;
    const role = isExistingAdmin ? "Administrateur" : (
      isAdminUser(submitted) ? "Secrétaire" : submitted.role || existing?.role || "Secrétaire"
    );
    const id = existing ? Number(existing.id) : ++nextId;
    const password = String(submitted.password || "").trim();
    const email = String(submitted.email || existing?.email || "").trim().toLowerCase();
    const username = normalizeUsername(submitted.username || existing?.username || email.split("@")[0] || submitted.name || `user-${id}`);
    nextUsers.push({
      id,
      name: String(submitted.name || existing?.name || "Utilisateur").trim(),
      username,
      email,
      passwordHash: password ? hashPassword(password) : existing?.passwordHash || hashPassword(crypto.randomBytes(18).toString("base64url")),
      role,
      status: role === "Administrateur" ? "active" : (["inactive", "suspended"].includes(submitted.status) ? submitted.status : "active"),
      mustChangePassword: password ? false : !!existing?.mustChangePassword,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: existing?.lastLoginAt || "",
      permissions: role === "Administrateur"
        ? [...ACCESS_VIEWS]
        : (Array.isArray(submitted.permissions) ? submitted.permissions : defaultPermissionsForRole(role))
          .filter(view => MANAGED_ACCESS_VIEWS.includes(view))
    });
  });

  if (!nextUsers.some(user => isAdminUser(user))) {
    const admin = previousUsers.find(user => isAdminUser(user)) || defaultDb().users[0];
    nextUsers.unshift({
      ...admin,
      status: "active",
      permissions: [...ACCESS_VIEWS]
    });
  }

  return nextUsers.filter(user => user.email && user.username);
}

function normalizeResetEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function requestIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "";
}

async function appendLoginHistory(db, entry) {
  const history = Array.isArray(db.loginHistory) ? db.loginHistory : [];
  const nextId = Math.max(0, ...history.map(item => Number(item.id) || 0)) + 1;
  db.loginHistory = [
    ...history,
    {
      id: nextId,
      at: new Date().toISOString(),
      ...entry
    }
  ].slice(-500);
}

function appendAuditLog(db, entry) {
  const history = Array.isArray(db.auditLog) ? db.auditLog : [];
  const nextId = Math.max(0, ...history.map(item => Number(item.id) || 0)) + 1;
  db.auditLog = [
    ...history,
    {
      id: nextId,
      at: new Date().toISOString(),
      ...entry
    }
  ].slice(-1000);
}

function collectionSignature(items = []) {
  return JSON.stringify(items.map(item => ({
    id: item.id,
    updated: item.updatedAt || item.correctedAt || item.deletedAt || "",
    count: Object.keys(item || {}).length,
    raw: item
  })));
}

function appendStateAudit(previous, next, user) {
  const tracked = [
    ["students", "Étudiants"],
    ["courses", "Formations"],
    ["groups", "Promotions"],
    ["enrollments", "Inscriptions"],
    ["payments", "Paiements"],
    ["cashEntries", "Caisse"],
    ["trainers", "Formateurs"],
    ["staffMembers", "Personnel"],
    ["staffPayments", "Paiements personnel"],
    ["attendanceSessions", "Présences étudiants"],
    ["trainerAttendanceSessions", "Présences professeurs"],
    ["evaluations", "Notes"],
    ["documentTemplates", "Modèles de documents"],
    ["requiredDocuments", "Documents obligatoires"],
    ["users", "Accès utilisateurs"]
  ];
  tracked.forEach(([key, label]) => {
    const before = previous[key];
    const after = next[key];
    if (JSON.stringify(before || null) === JSON.stringify(after || null)) return;
    const beforeCount = Array.isArray(before) ? before.length : Object.keys(before || {}).length;
    const afterCount = Array.isArray(after) ? after.length : Object.keys(after || {}).length;
    appendAuditLog(next, {
      action: "Modification",
      section: label,
      detail: `${beforeCount} -> ${afterCount}`,
      operator: user.name || user.email || "",
      operatorEmail: user.email || ""
    });
  });
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    const storage = isMysqlStorage() ? "mysql" : "json";
    if (storage === "mysql") {
      try {
        await ensureDb();
      } catch (error) {
        sendJson(response, 503, {
          ok: false,
          app: "CFP EREXIT Manager",
          storage,
          database: "error",
          error: error.message
        });
        return;
      }
    }
    sendJson(response, 200, {
      ok: true,
      app: "CFP EREXIT Manager",
      storage,
      database: storage === "mysql" ? "connected" : "local-json"
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/logo") {
    try {
      const file = await fs.readFile(LOGO_PATH);
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0"
      });
      response.end(file);
    } catch {
      sendError(response, 404, "Logo introuvable");
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/public-center") {
    const db = await readDb();
    sendJson(response, 200, {
      center: {
        name: db.center?.name || "CFP EREXIT",
        subtitle: db.center?.subtitle || "Centre de Formation Professionnelle",
        logoData: db.center?.logoData ? `/api/logo?v=${encodeURIComponent(String(db.updatedAt || Date.now()))}` : ""
      }
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/online-registration-options") {
    const db = await readDb();
    const courses = (db.courses || [])
      .filter(course => String(course.status || "active") === "active")
      .map(course => ({
        id: course.id,
        code: course.code || "",
        name: course.name || "",
        trainingFee: Number(course.trainingFee || 0),
        monthlyFee: Number(course.monthlyFee || 0)
      }));
    const activeCourseIds = new Set(courses.map(course => Number(course.id)));
    const groups = (db.groups || [])
      .filter(group => activeCourseIds.has(Number(group.courseId)) && String(group.status || "active") === "active")
      .map(group => ({
        id: group.id,
        courseId: group.courseId,
        name: group.name || "",
        year: group.year || "",
        sessionType: group.sessionType || "jour",
        sessionTypeLabel: groupSessionLabel(group)
      }));
    sendJson(response, 200, { courses, groups });
    return;
  }

  if (request.method === "POST" && pathname === "/api/online-registration") {
    const body = await readBody(request);
    const lastName = String(body.lastName || "").trim().toUpperCase();
    const firstName = String(body.firstName || "").trim();
    const phone = String(body.phone || "").trim();
    const courseId = Number(body.courseId || 0);
    if (!lastName || !firstName || !phone || !courseId) {
      sendError(response, 400, "Nom, prénom, téléphone et formation sont obligatoires");
      return;
    }

    const result = await withDbWriteLock(async () => {
      const db = await readDb();
      const course = (db.courses || []).find(item => Number(item.id) === courseId && String(item.status || "active") === "active");
      if (!course) {
        return { status: 400, payload: { error: "Formation indisponible" } };
      }

      const requestPhoneDigits = normalizeDigits(phone);
      const requestEmail = normalizeResetEmail(body.email);
      const existingStudent = (db.students || []).find(item => {
        const samePhone = requestPhoneDigits && normalizeDigits(item.phone) === requestPhoneDigits;
        const sameEmail = requestEmail && normalizeResetEmail(item.email) === requestEmail;
        const sameName = normalizeSearchText(item.lastName) === normalizeSearchText(lastName) &&
          normalizeSearchText(item.firstName) === normalizeSearchText(firstName);
        return sameName && (samePhone || sameEmail);
      });
      const duplicatePending = (db.onlineRegistrationRequests || []).find(item => {
        const samePhone = requestPhoneDigits && normalizeDigits(item.phone) === requestPhoneDigits;
        const sameEmail = requestEmail && normalizeResetEmail(item.email) === requestEmail;
        const sameName = normalizeSearchText(item.lastName) === normalizeSearchText(lastName) &&
          normalizeSearchText(item.firstName) === normalizeSearchText(firstName);
        return sameName && Number(item.courseId) === courseId && !["refusee", "convertie"].includes(String(item.status || ""));
      });
      if (duplicatePending) {
        return {
          status: 409,
          payload: {
            error: "Une demande en ligne existe deja pour cette formation. Le secretariat va la traiter.",
            requestNumber: duplicatePending.requestNumber || `DEM-${duplicatePending.id}`
          }
        };
      }

      const now = new Date().toISOString();
      const requestId = nextId(db.onlineRegistrationRequests || []);
      const requestNumber = `DEM-${yearFromDate()}-${String(requestId).padStart(4, "0")}`;
      const registrationRequest = {
        id: requestId,
        requestNumber,
        status: "nouvelle",
        statusLabel: "Nouvelle demande",
        submittedAt: now,
        updatedAt: now,
        source: String(body.source || "site-web").trim() || "site-web",
        existingStudentId: existingStudent?.id || null,
        firstName,
        lastName,
        gender: String(body.gender || ""),
        birthDate: String(body.birthDate || ""),
        birthPlace: String(body.birthPlace || ""),
        nationality: String(body.nationality || ""),
        phone,
        email: requestEmail,
        address: String(body.address || "").trim(),
        district: String(body.district || ""),
        city: String(body.city || ""),
        country: String(body.country || ""),
        studyLevel: String(body.studyLevel || ""),
        profession: String(body.profession || ""),
        courseId,
        preferredCourseType: String(body.preferredCourseType || ""),
        emergencyName: String(body.emergencyName || "").trim(),
        emergencyPhone: String(body.emergencyPhone || "").trim(),
        paymentResponsible: String(body.paymentResponsible || ""),
        paymentResponsiblePhone: String(body.paymentResponsiblePhone || ""),
        message: String(body.message || "").trim(),
        documents: Array.isArray(body.documents) ? body.documents : []
      };
      db.onlineRegistrationRequests = [...(db.onlineRegistrationRequests || []), registrationRequest];
      const notificationId = nextId(db.notifications || []);
      db.notifications = [
        ...(db.notifications || []),
        {
          id: notificationId,
          audience: "backoffice",
          type: "online-registration",
          title: "Nouvelle demande d'inscription en ligne",
          message: `${lastName} ${firstName} souhaite suivre ${course.name || course.code || "une formation"}.`,
          status: "unread",
          createdAt: now,
          targetId: requestId
        }
      ];
      db.updatedAt = now;
      db.updatedBy = "inscription-en-ligne";
      await writeDb(db);
      await writeAutoBackup(db).catch(() => {});
      return {
        status: 200,
        payload: {
          ok: true,
          requestNumber,
          message: "Demande de preinscription enregistree"
        }
      };

      const normalizedPhone = normalizeDigits(phone);
      const normalizedEmail = normalizeResetEmail(body.email);
      let student = (db.students || []).find(item => {
        const samePhone = normalizedPhone && normalizeDigits(item.phone) === normalizedPhone;
        const sameEmail = normalizedEmail && normalizeResetEmail(item.email) === normalizedEmail;
        const sameName = normalizeSearchText(item.lastName) === normalizeSearchText(lastName) &&
          normalizeSearchText(item.firstName) === normalizeSearchText(firstName);
        return sameName && (samePhone || sameEmail);
      });

      if (!student) {
        student = {
          id: nextId(db.students || []),
          matricule: generateMatricule(db, yearFromDate()),
          firstName,
          lastName,
          gender: String(body.gender || ""),
          birthDate: String(body.birthDate || ""),
          phone,
          email: normalizedEmail,
          address: String(body.address || "").trim(),
          emergencyName: String(body.emergencyName || "").trim(),
          emergencyPhone: String(body.emergencyPhone || "").trim(),
          status: "preinscrit",
          photoData: "",
          documents: [],
          onlineRegistration: {
            requestedAt: new Date().toISOString(),
            message: String(body.message || "").trim()
          }
        };
        db.students = [...(db.students || []), student];
      }

      const alreadyEnrolled = (db.enrollments || []).some(enrollment =>
        Number(enrollment.studentId) === Number(student.id) &&
        Number(enrollment.courseId) === courseId &&
        Number(enrollment.groupId || 0) === 0 &&
        !["annulee", "desiste"].includes(String(enrollment.status || ""))
      );
      if (!alreadyEnrolled) {
        const totalAmount = courseCost(course);
        db.enrollments = [
          ...(db.enrollments || []),
          {
            id: nextId(db.enrollments || []),
            studentId: student.id,
            courseId,
            groupId: 0,
            date: new Date().toISOString().slice(0, 10),
            totalAmount,
            discountAmount: 0,
            finalAmount: totalAmount,
            status: "en attente",
            source: "online",
            note: String(body.message || "").trim()
          }
        ];
      }

      db.updatedAt = new Date().toISOString();
      db.updatedBy = "inscription-en-ligne";
      await writeDb(db);
      await writeAutoBackup(db).catch(() => {});
      return {
        status: 200,
        payload: {
          ok: true,
          matricule: student.matricule,
          studentId: student.id,
          message: "Préinscription enregistrée"
        }
      };
    });
    sendJson(response, result.status, result.payload);
    return;
  }

  if (request.method === "POST" && pathname === "/api/online-payment/initiate") {
    const body = await readBody(request);
    const matricule = String(body.matricule || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const enrollmentId = Number(body.enrollmentId || 0);
    const amount = Number(body.amount || 0);
    const motif = String(body.motif || "scolarite").trim();
    const provider = String(body.provider || "autre").trim();
    if (!matricule || !phone || !enrollmentId || amount <= 0) {
      sendError(response, 400, "Matricule, telephone, inscription et montant sont requis");
      return;
    }

    const result = await withDbWriteLock(async () => {
      const db = await readDb();
      const student = db.students.find(item => {
        const sameMatricule = String(item.matricule || "").trim().toLowerCase() === matricule;
        return sameMatricule && (phoneMatches(phone, item.phone) || phoneMatches(phone, item.emergencyPhone));
      });
      if (!student || ["suspendu", "archive"].includes(String(student.status || "").toLowerCase())) {
        return { status: 401, payload: { error: "Compte etudiant indisponible" } };
      }
      const enrollment = (db.enrollments || []).find(item =>
        Number(item.id) === enrollmentId && Number(item.studentId) === Number(student.id)
      );
      if (!enrollment) {
        return { status: 404, payload: { error: "Inscription introuvable" } };
      }
      const tuitionMotif = TUITION_MOTIF_KEYS.includes(motif);
      if (tuitionMotif) {
        const paid = (db.payments || [])
          .filter(payment => Number(payment.enrollmentId) === enrollmentId && isTuitionPayment(payment))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const rest = Math.max(0, tuitionExpectedForEnrollment(db, enrollment) - paid);
        if (amount > rest) {
          return { status: 400, payload: { error: "Le montant depasse le reste de scolarite" } };
        }
      }
      const now = new Date().toISOString();
      const onlinePaymentId = nextId(db.onlinePayments || []);
      const referenceTransaction = `PAY-${yearFromDate()}-${String(onlinePaymentId).padStart(5, "0")}`;
      db.onlinePayments = [
        ...(db.onlinePayments || []),
        {
          id: onlinePaymentId,
          studentId: student.id,
          enrollmentId,
          formationId: enrollment.courseId,
          motif,
          category: tuitionMotif ? "scolarite" : "frais-annexe",
          amount,
          modePaiement: "en ligne",
          provider,
          referenceTransaction,
          status: "en attente",
          initiatedAt: now,
          confirmedAt: "",
          receiptGenerated: false,
          receiptId: null
        }
      ];
      db.notifications = [
        ...(db.notifications || []),
        {
          id: nextId(db.notifications || []),
          audience: "backoffice",
          type: "online-payment-pending",
          title: "Paiement en ligne initie",
          message: `${fullName(student)} a initie ${amount} FCFA via ${provider}.`,
          status: "unread",
          createdAt: now,
          targetId: onlinePaymentId
        },
        {
          id: notificationId + 1,
          audience: "student",
          studentId: student.id,
          type: "online-payment-pending",
          title: "Paiement en ligne initié",
          message: `Votre paiement de ${amount} FCFA via ${provider} est en attente de confirmation. Référence : ${referenceTransaction}.`,
          status: "unread",
          createdAt: now,
          targetId: onlinePaymentId
        }
      ];
      db.updatedAt = now;
      db.updatedBy = "paiement-en-ligne";
      await writeDb(db);
      return { status: 200, payload: { ok: true, referenceTransaction, status: "en attente" } };
    });
    sendJson(response, result.status, result.payload);
    return;
  }

  if (request.method === "POST" && pathname === "/api/student-portal") {
    const body = await readBody(request);
    const matricule = String(body.matricule || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    if (!matricule || !phone) {
      sendError(response, 400, "Matricule et téléphone requis");
      return;
    }
    const db = await readDb();
    const student = db.students.find(item => {
      const sameMatricule = String(item.matricule || "").trim().toLowerCase() === matricule;
      return sameMatricule && (phoneMatches(phone, item.phone) || phoneMatches(phone, item.emergencyPhone));
    });

    if (!student) {
      sendError(response, 401, "Informations étudiant incorrectes");
      return;
    }

    sendJson(response, 200, studentPortalPayload(db, student));
    return;
  }

  if (request.method === "POST" && pathname === "/api/password-reset-request") {
    const body = await readBody(request);
    const email = normalizeResetEmail(body.email);
    if (!email) {
      sendError(response, 400, "Email requis");
      return;
    }

    const genericMessage = "Si ce compte existe, la demande sera transmise à l'administrateur.";
    await withDbWriteLock(async () => {
      const db = await readDb();
      const user = db.users.find(item => normalizeResetEmail(item.email) === email);
      if (!user) return;

      const pending = (db.passwordResetRequests || []).find(request => request.email === email && request.status !== "done");
      if (!pending) {
        const requests = Array.isArray(db.passwordResetRequests) ? db.passwordResetRequests : [];
        const nextId = Math.max(0, ...requests.map(request => Number(request.id) || 0)) + 1;
        db.passwordResetRequests = [
          ...requests,
          {
            id: nextId,
            email,
            userId: user.id,
            requestedAt: new Date().toISOString(),
            status: "pending"
          }
        ];
        await writeDb(db);
      }
    });
    sendJson(response, 200, { ok: true, message: genericMessage });
    return;
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readBody(request);
    const identifier = String(body.identifier || body.email || "").trim().toLowerCase();
    const username = normalizeUsername(identifier);
    const password = String(body.password || "");
    const loginResult = await withDbWriteLock(async () => {
      const db = await readDb();
      const user = db.users.find(item =>
        item.status === "active" &&
        (String(item.email || "").toLowerCase() === identifier || normalizeUsername(item.username) === username)
      );
      const now = Date.now();
      if (user?.lockedUntil && new Date(user.lockedUntil).getTime() > now) {
        await appendLoginHistory(db, {
          email: identifier,
          identifier,
          userId: user.id,
          userName: user.name || "",
          role: user.role || "",
          success: false,
          ip: requestIp(request),
          reason: "Compte temporairement verrouillé"
        });
        await writeDb(db);
        return { ok: false };
      }

      if (!user || !verifyPassword(password, user.passwordHash)) {
        if (user) {
          const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
          user.failedLoginCount = failedLoginCount;
          if (failedLoginCount >= 5) {
            user.lockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
          }
          user.updatedAt = new Date().toISOString();
        }
        await appendLoginHistory(db, {
          email: identifier,
          identifier,
          userId: user?.id || null,
          userName: user?.name || "",
          role: user?.role || "",
          success: false,
          ip: requestIp(request),
          reason: user ? "Mot de passe incorrect" : "Utilisateur introuvable ou inactif"
        });
        await writeDb(db);
        return { ok: false };
      }

      if (passwordNeedsRehash(user.passwordHash)) {
        user.passwordHash = hashPassword(password);
      }
      user.failedLoginCount = 0;
      user.lockedUntil = "";
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = user.lastLoginAt;
      await appendLoginHistory(db, {
        email: user.email || identifier,
        identifier: user.username || identifier,
        userId: user.id,
        userName: user.name || "",
        role: user.role || "",
        success: true,
        ip: requestIp(request),
        reason: ""
      });
      await writeDb(db);
      return { ok: true, user };
    });

    if (!loginResult.ok) {
      sendError(response, 401, "Identifiants incorrects");
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    sessions.set(token, { userId: loginResult.user.id, createdAt: now, lastActivity: now });
    sendJson(response, 200, { user: publicUser(loginResult.user) }, { "Set-Cookie": sessionCookie(token, request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    sendJson(response, 200, { ok: true }, { "Set-Cookie": clearCookie(request) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/change-password") {
    const sessionUser = await requireUser(request, response);
    if (!sessionUser) return;

    const { currentPassword = "", newPassword = "" } = await readBody(request);
    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      sendError(response, 400, policyError);
      return;
    }

    const result = await withDbWriteLock(async () => {
      const db = await readDb();
      const user = db.users.find(item => Number(item.id) === Number(sessionUser.id));
      if (!user || user.status === "inactive") {
        return { status: 401, payload: { error: "Session invalide" } };
      }
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        return { status: 400, payload: { error: "Mot de passe actuel incorrect" } };
      }
      if (verifyPassword(newPassword, user.passwordHash)) {
        return { status: 400, payload: { error: "Le nouveau mot de passe doit etre different de l'ancien" } };
      }
      user.passwordHash = hashPassword(newPassword);
      user.mustChangePassword = false;
      user.failedLoginCount = 0;
      user.lockedUntil = "";
      user.updatedAt = new Date().toISOString();
      await appendLoginHistory(db, {
        email: user.email || "",
        identifier: user.username || user.email || "",
        userId: user.id,
        userName: user.name || "",
        role: user.role || "",
        success: true,
        ip: requestIp(request),
        reason: "Mot de passe change"
      });
      await writeDb(db);
      return { status: 200, payload: { ok: true, user: publicUser(user) } };
    });

    sendJson(response, result.status, result.payload);
    return;
  }

  if (request.method === "GET" && pathname === "/api/me") {
    const user = await currentUser(request);
    if (!user) {
      sendJson(response, 200, { user: null });
      return;
    }
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/upload") {
    const user = await requireUser(request, response);
    if (!user) return;
    const body = await readBody(request);
    const dataUrl = String(body.data || "");
    const name = String(body.name || "fichier");
    const folder = String(body.folder || "documents").replace(/[^a-zA-Z0-9/_-]/g, "");
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      sendError(response, 400, "Fichier invalide");
      return;
    }
    const uploadError = validateUpload({ mime: parsed.mime, name, size: parsed.buffer.length });
    if (uploadError) {
      sendError(response, 400, uploadError);
      return;
    }
    const url = await saveUploadFromDataUrl({ dataUrl, name, folder });
    await withDbWriteLock(async () => {
      const db = await readDb();
      appendAuditLog(db, {
        action: "Ajout fichier",
        section: "Dossiers numériques",
        detail: name,
        operator: user.name || user.email || "",
        operatorEmail: user.email || ""
      });
      await writeDb(db);
    });
    sendJson(response, 200, { ok: true, url });
    return;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    const user = await requireUser(request, response);
    if (!user) return;
    const db = await readDb();
    sendJson(response, 200, publicState(db, user));
    return;
  }

  if (request.method === "PUT" && pathname === "/api/state") {
    const user = await requireUser(request, response);
    if (!user) return;

    const body = await readBody(request);
    const result = await withDbWriteLock(async () => {
      const previous = await readDb();
      const clientRevision = String(body.clientRevision || body.updatedAt || "");
      const currentRevision = String(previous.updatedAt || "");
      if (clientRevision !== currentRevision) {
        return {
          status: 409,
          payload: {
            error: "Les données ont été modifiées sur un autre poste. Rechargez la dernière version avant d'enregistrer.",
            updatedAt: currentRevision,
            state: publicState(previous, user)
          }
        };
      }
      const forbiddenChanges = forbiddenStateChanges(previous, body, user);
      if (forbiddenChanges.length) {
        return {
          status: 403,
          payload: {
            error: `Action non autorisée pour ce profil (${forbiddenChanges.join(", ")})`
          }
        };
      }
      if (isAdminUser(user) && Array.isArray(body.users)) {
        for (const submittedUser of body.users) {
          const password = String(submittedUser.password || "").trim();
          const isNewUser = !previous.users.some(existing => Number(existing.id) === Number(submittedUser.id));
          if (isNewUser && !password) {
            return { status: 400, payload: { error: "Mot de passe obligatoire pour un nouvel utilisateur" } };
          }
          if (password) {
            const policyError = passwordPolicyError(password);
            if (policyError) return { status: 400, payload: { error: policyError } };
          }
        }
      }
      const managedUsers = isAdminUser(user) && Array.isArray(body.users)
        ? (body.users.length ? normalizeManagedUsers(body.users, previous.users) : previous.users)
        : previous.users;
      const userEmails = managedUsers.map(item => item.email).filter(Boolean);
      if (new Set(userEmails).size !== userEmails.length) {
        return { status: 400, payload: { error: "Deux utilisateurs ont le même email" } };
      }
      const usernames = managedUsers.map(item => normalizeUsername(item.username)).filter(Boolean);
      if (new Set(usernames).size !== usernames.length) {
        return { status: 400, payload: { error: "Deux utilisateurs ont le même identifiant" } };
      }
      const submittedLogoData = String(body.center?.logoData || "");
      const collectionFromBody = collection => (
        canWriteCollection(user, collection) && Array.isArray(body[collection])
          ? body[collection]
          : previous[collection]
      );
      const center = body.center && canWriteCollection(user, "center")
        ? {
            ...body.center,
            logoData: submittedLogoData.startsWith("/api/logo")
              ? previous.center?.logoData || ""
              : submittedLogoData
          }
        : previous.center;
      const next = {
        ...previous,
        center,
        academicSettings: canWriteCollection(user, "academicSettings")
          ? normalizeAcademicSettings(body.academicSettings || previous.academicSettings)
          : previous.academicSettings,
        securitySettings: canWriteCollection(user, "securitySettings")
          ? normalizeSecuritySettings(body.securitySettings || previous.securitySettings)
          : previous.securitySettings,
        students: collectionFromBody("students"),
        courses: collectionFromBody("courses"),
        paymentMotifs: collectionFromBody("paymentMotifs"),
        documentTemplates: collectionFromBody("documentTemplates"),
        requiredDocuments: canWriteCollection(user, "requiredDocuments")
          ? normalizeRequiredDocuments(body.requiredDocuments || previous.requiredDocuments)
          : previous.requiredDocuments,
        groups: collectionFromBody("groups"),
        trainers: collectionFromBody("trainers"),
        staffMembers: collectionFromBody("staffMembers"),
        users: managedUsers,
        onlineRegistrationRequests: collectionFromBody("onlineRegistrationRequests"),
        studentAccounts: collectionFromBody("studentAccounts"),
        onlinePayments: collectionFromBody("onlinePayments"),
        notifications: collectionFromBody("notifications"),
        planningEvents: collectionFromBody("planningEvents"),
        announcements: collectionFromBody("announcements"),
        rooms: collectionFromBody("rooms"),
        equipment: collectionFromBody("equipment"),
        enrollments: collectionFromBody("enrollments"),
        payments: collectionFromBody("payments"),
        paymentAuditLog: collectionFromBody("paymentAuditLog"),
        passwordResetRequests: collectionFromBody("passwordResetRequests"),
        loginHistory: previous.loginHistory,
        cashEntries: collectionFromBody("cashEntries"),
        staffPayments: collectionFromBody("staffPayments"),
        attendanceSessions: collectionFromBody("attendanceSessions"),
        trainerAttendanceSessions: collectionFromBody("trainerAttendanceSessions"),
        evaluations: collectionFromBody("evaluations"),
        updatedAt: new Date().toISOString(),
        updatedBy: user.email
      };

      appendStateAudit(previous, next, user);
      await writeDb(next);
      await writeAutoBackup(next).catch(() => {});
      return { status: 200, payload: { ok: true, updatedAt: next.updatedAt, state: publicState(next, user) } };
    });
    sendJson(response, result.status, result.payload);
    return;
  }

  sendError(response, 404, "API introuvable");
}

async function serveStatic(request, response, pathname) {
  const urlPath = pathname === "/" || pathname === "/inscription" ? "/index.html" : pathname;
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Chemin invalide");
    return;
  }

  const rootPath = path.resolve(ROOT_DIR);
  const relativePath = decodedPath.replace(/^[/\\]+/, "");
  const filePath = path.resolve(rootPath, relativePath);

  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
    response.writeHead(403);
    response.end("Acces refuse");
    return;
  }
  const uploadsPath = path.resolve(UPLOAD_DIR);
  if (relativePath.startsWith("uploads/") && !filePath.startsWith(`${uploadsPath}${path.sep}`)) {
    response.writeHead(403);
    response.end("Acces refuse");
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error("Not a file");
    }
    const extension = path.extname(filePath).toLowerCase();
    const cacheControl = extension === ".html"
      ? "no-store, max-age=0"
      : "public, max-age=300";
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": cacheControl,
      "Content-Length": stats.size
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = fsSync.createReadStream(filePath);
    stream.on("error", error => {
      console.error("Erreur lecture fichier statique:", filePath, error);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end();
    });
    stream.pipe(response);
  } catch (error) {
    console.error("Fichier statique introuvable:", filePath, error.message);
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Fichier introuvable");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl.pathname);
      return;
    }
    await serveStatic(request, response, requestUrl.pathname);
  } catch (error) {
    console.error(error);
    sendError(response, 500, "Erreur serveur");
  }
});

server.listen(PORT, HOST, async () => {
  await ensureDb();
  await syncLogoFile(await readDb()).catch(() => {});
  console.log(`CFP EREXIT Manager disponible sur http://localhost:${PORT}`);
  console.log(`Acces reseau local : http://ADRESSE-IP-DU-PC:${PORT}`);
  console.log("Compte administrateur : admin / admin123");
});
