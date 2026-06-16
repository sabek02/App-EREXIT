# CFP EREXIT Manager

Application de gestion pour centre de formation professionnelle.

CFP EREXIT Manager permet de centraliser la gestion administrative, pédagogique et financière d’un centre de formation dans une seule application.  
L’application couvre la gestion des apprenants, formations, promotions, inscriptions, paiements, présences, évaluations, rapports, documents, portail étudiant et préinscription en ligne.

---

## Objectif

L’objectif du projet est de fournir un outil unique pour :

- gérer les apprenants et leur dossier administratif
- suivre les inscriptions et les promotions
- gérer les paiements et la caisse
- enregistrer les présences et les notes
- produire des documents imprimables
- proposer un portail étudiant
- recevoir des préinscriptions en ligne
- fonctionner en local ou en mode serveur multi-utilisateur

---

## Fonctionnalités

### Administration
- tableau de bord
- gestion des utilisateurs
- rôles et permissions
- historique de connexion
- journal d’audit
- sauvegarde serveur

### Gestion académique
- apprenants
- formations
- promotions / groupes
- inscriptions
- matricule automatique au format `ERX-annee-00000`
- formateurs
- présences
- évaluations
- relevé de notes imprimable

### Gestion financière
- paiements
- caisse
- reçus imprimables
- montants configurables par motif
- motif libre pour paiements divers
- rapports financiers
- export CSV

### Gestion documentaire
- fiche d’inscription imprimable
- modèles de documents
- pièces jointes par profil
- contrôle des documents obligatoires

### Expérience étudiant
- portail étudiant
- accès par matricule + téléphone
- consultation d’informations académiques et financières

### Accès public
- formulaire de préinscription en ligne
- traitement des demandes dans le back-office

---

## Technologies utilisées

- HTML
- CSS
- JavaScript
- Node.js
- stockage JSON local
- MySQL / MariaDB en option pour le mode multi-utilisateur

---

## Installation

### Prérequis
- Node.js
- npm

### Installation des dépendances

```bash
npm install
```

---

## Lancement

### Version locale simple

Ouvrir directement :

```text
index.html
```

Cette version fonctionne dans le navigateur et sauvegarde les données dans le stockage local du navigateur.

### Version serveur recommandée

Lancer :

```bash
npm start
```

Puis ouvrir :

```text
http://localhost:3000
```

Depuis un autre poste du même réseau :

```text
http://ADRESSE-IP-DU-PC:3000
```

Pour un hébergement en ligne, lancer le même serveur Node.js avec HTTPS actif.

---

## Stockage des données

### Mode par défaut

Sans configuration MySQL, les données sont stockées dans :

```text
data/db.json
```

Des sauvegardes automatiques sont conservées dans :

```text
data/backups
```

### Mode multi-utilisateur MySQL / MariaDB

Configurer les variables d’environnement suivantes :

```text
MYSQL_HOST=localhost
MYSQL_DATABASE=nom_de_la_base
MYSQL_USER=nom_utilisateur_mysql
MYSQL_PASSWORD=mot_de_passe_mysql
MYSQL_PORT=3306
```

Ou une URL unique :

```text
DATABASE_URL=mysql://utilisateur:motdepasse@localhost:3306/nom_de_la_base
```

Ensuite lancer :

```bash
npm install
npm start
```

Au premier démarrage, l’application crée automatiquement les tables nécessaires et migre les données existantes depuis `data/db.json` si la base est vide.

Pour vérifier le stockage actif :

```text
GET /api/health
```

Le champ `storage` doit indiquer `mysql`.

---

## Portail étudiant et inscription en ligne

Le formulaire public est disponible sur :

```text
/inscription
```

Routes utiles :

```text
GET  /api/online-registration-options
POST /api/online-registration
```

Une soumission crée une demande dans `onlineRegistrationRequests`.  
Elle ne crée pas directement une inscription validée.

Dans le back-office, le module **Demandes en ligne** permet de :

- suivre les nouvelles demandes
- passer une demande en vérification
- demander un complément
- refuser une demande
- convertir une demande en fiche étudiant + inscription officielle
- créer un accès portail étudiant

---

## Paiement en ligne

La base technique est prête avec :

```text
POST /api/online-payment/initiate
```

Cette route crée une transaction `en attente` dans `onlinePayments`.

La transaction ne modifie pas encore automatiquement le solde et ne génère pas encore de reçu tant qu’un futur webhook fournisseur n’a pas confirmé le paiement.

---

## Comptes de test

- Administrateur : `admin` / `admin123`
- Secrétariat : `secretariat` / `secret123`
- Comptabilité : `comptable` / `compta123`
- Formateur : `formateur` / `formateur123`

Important : ces mots de passe sont des mots de passe initiaux de démonstration.  
Ils doivent être changés immédiatement.

Règle minimale actuelle :
- au moins 8 caractères
- une majuscule
- une minuscule
- un chiffre
- un caractère spécial

---

## Structure du projet

- `index.html` : structure de l’application
- `styles.css` : interface et responsive
- `app.js` : logique front-end, vues, interactions et rendu
- `server.js` : serveur web, API, authentification et stockage
- `data/db.json` : base JSON par défaut
- `data/backups` : sauvegardes automatiques
- `package.json` : dépendances et scripts
- `.env.example` : exemple de configuration
- `schema-cfp-erexit.sql` : ancien schéma de référence
- `schema-cfp-erexit-mysql.sql` : schéma MySQL utilisé par la version multi-utilisateur
- `cahier-des-charges-cfp-erexit.md` : spécification fonctionnelle

---

## État actuel du projet

Le projet dispose déjà d’une base fonctionnelle solide pour un centre de formation :

- back-office opérationnel
- gestion des rôles
- inscriptions et suivi apprenants
- paiements et reçus
- portail étudiant
- préinscription publique
- stockage local ou serveur
- mode multi-utilisateur possible via MySQL/MariaDB

---

## Limites actuelles

Pour une utilisation officielle en production, il faut encore renforcer :

- HTTPS
- gestion stricte des comptes réels
- robustesse des mots de passe
- sauvegardes automatiques côté hébergeur
- supervision et monitoring
- industrialisation de certains workflows métier

---

## Roadmap

### V1 — Stabilisation et mise en service
- workflow complet de préinscription et validation administrative
- contrôle des dossiers et des pièces obligatoires
- suivi plus fiable des paiements et impayés
- documents imprimables homogènes : attestation, contrat, reçu, relevé
- correction des bugs et durcissement sécurité/session

### V2 — Pilotage métier
- échéancier par inscription et relances
- gestion des années académiques et archivage
- modules, coefficients, moyennes et décisions
- tableau de bord décisionnel
- portail étudiant enrichi

### V3 — Industrialisation
- paiement en ligne complet avec webhook
- notifications email / SMS / WhatsApp
- emploi du temps
- refactor technique front-end / API
- déploiement production renforcé

---

## Priorités recommandées

### Priorité haute
- dossier étudiant complet
- impayés et relances
- génération de documents plus robuste
- stabilisation technique

### Priorité moyenne
- année académique
- modules et coefficients
- dashboard décisionnel
- enrichissement du portail étudiant

### Priorité plus tard
- paiement en ligne complet
- notifications externes
- emploi du temps
- refonte technique plus lourde

---

## Évolution technique recommandée

À court terme, la priorité n’est pas de réécrire immédiatement l’application dans un autre framework.

La meilleure stratégie est :

1. finaliser les workflows métier essentiels
2. stabiliser le code existant
3. améliorer la structure technique
4. envisager ensuite, si nécessaire, une migration vers Laravel, Django ou une autre architecture plus modulaire

---

## Lancement rapide

```bash
npm install
npm start
```

Puis ouvrir :

```text
http://localhost:3000
```

---

## Licence

Définir la licence du projet selon votre mode de diffusion.
