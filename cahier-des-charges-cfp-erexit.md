# Cahier des charges - Application de gestion CFP EREXIT

## 1. Nom du projet

**CFP EREXIT Manager**

Application web de gestion administrative, pedagogique et financiere du centre de formation professionnelle **CFP EREXIT**.

## 2. Objectif general

L'application doit permettre au centre CFP EREXIT de gerer facilement :

- les apprenants ;
- les inscriptions ;
- les formations et filieres ;
- les promotions/classes ;
- les paiements ;
- les presences et absences ;
- les formateurs ;
- les notes et evaluations ;
- les documents administratifs ;
- les rapports de gestion.

L'application doit etre accessible depuis ordinateur, tablette et telephone.

## 3. Utilisateurs et roles

### Administrateur

- gere tous les utilisateurs ;
- configure les formations, annees, frais et parametres ;
- consulte tous les rapports ;
- peut modifier ou supprimer les donnees sensibles.

### Directeur

- consulte le tableau de bord general ;
- suit les inscriptions, paiements, presences et resultats ;
- valide certains documents officiels.

### Secretaire

- enregistre les apprenants ;
- cree les inscriptions ;
- imprime les fiches d'inscription ;
- consulte les listes de classes.

### Comptable

- enregistre les paiements ;
- imprime les recus ;
- suit les impayes ;
- genere les rapports financiers.

### Formateur

- consulte ses classes ;
- fait l'appel ;
- saisit les notes ;
- consulte les listes de ses apprenants.

### Apprenant, optionnel

- consulte son inscription ;
- consulte ses paiements ;
- consulte ses notes ;
- telecharge certains documents.

## 4. Modules principaux

### 4.1 Tableau de bord

Le tableau de bord affiche :

- nombre total d'apprenants ;
- nombre d'apprenants actifs ;
- formations actives ;
- inscriptions du mois ;
- paiements du jour, du mois et de l'annee ;
- total des impayes ;
- absences recentes ;
- alertes importantes.

### 4.2 Gestion des apprenants

Chaque apprenant doit avoir une fiche complete :

- matricule ;
- nom ;
- prenom ;
- sexe ;
- date de naissance ;
- lieu de naissance ;
- telephone ;
- email ;
- adresse ;
- personne a contacter ;
- telephone du contact ;
- photo, optionnel ;
- statut : preinscrit, actif, suspendu, termine, abandon.

Fonctions attendues :

- ajouter un apprenant ;
- modifier une fiche ;
- rechercher un apprenant ;
- filtrer par formation, promotion ou statut ;
- imprimer la fiche apprenant.

### 4.3 Formations et filieres

Exemples de formations :

- informatique bureautique ;
- secretariat bureautique ;
- comptabilite ;
- electricite ;
- maintenance informatique ;
- infographie ;
- hotellerie ;
- couture ;
- entrepreneuriat.

Chaque formation contient :

- nom ;
- code ;
- duree ;
- description ;
- frais d'inscription ;
- frais de formation ;
- mensualite ;
- nombre de modules ;
- statut : active ou inactive.

### 4.4 Promotions / Classes

Une promotion represente un groupe d'apprenants inscrit a une formation pendant une periode.

Champs principaux :

- nom de la promotion ;
- formation associee ;
- annee academique ;
- date de debut ;
- date de fin ;
- formateur principal ;
- capacite maximale ;
- statut.

Exemple : **Bureautique 2026 - Groupe A**.

### 4.5 Inscriptions

Fonctions :

- inscrire un apprenant dans une formation ;
- affecter une promotion/classe ;
- definir le montant total a payer ;
- enregistrer les frais d'inscription ;
- generer une fiche d'inscription ;
- changer le statut de l'inscription.

Statuts possibles :

- en attente ;
- validee ;
- annulee ;
- terminee.

### 4.6 Paiements

Le module paiement doit permettre :

- paiement des frais d'inscription ;
- paiement des mensualites ;
- paiement partiel ;
- calcul automatique du reste a payer ;
- historique des paiements par apprenant ;
- generation de recu ;
- rapport des impayes.

Informations d'un paiement :

- numero de recu ;
- apprenant ;
- inscription ;
- montant paye ;
- mode de paiement : espece, mobile money, virement, cheque ;
- motif ;
- date ;
- utilisateur ayant encaisse.

### 4.7 Presences et absences

Fonctions :

- faire l'appel par promotion/classe ;
- marquer present, absent, retard ou excuse ;
- ajouter un commentaire ;
- consulter l'historique des presences ;
- afficher les absences par apprenant ;
- generer une liste de presence.

### 4.8 Notes et evaluations

Fonctions :

- creer des evaluations ;
- saisir les notes par module ;
- calculer les moyennes ;
- generer un releve de notes ;
- ajouter une appreciation.

Types d'evaluations :

- devoir ;
- examen ;
- pratique ;
- projet ;
- stage.

### 4.9 Formateurs

Chaque formateur possede une fiche :

- nom ;
- prenom ;
- telephone ;
- email ;
- specialite ;
- modules enseignes ;
- classes affectees ;
- statut.

### 4.10 Documents et rapports

Documents a generer en PDF :

- fiche d'inscription ;
- recu de paiement ;
- liste des apprenants ;
- liste de presence ;
- releve de notes ;
- attestation de formation ;
- rapport financier ;
- rapport des impayes ;
- rapport des absences.

## 5. Structure de navigation

Menu principal recommande :

- Tableau de bord
- Apprenants
- Inscriptions
- Formations
- Promotions / Classes
- Paiements
- Presences
- Notes
- Formateurs
- Rapports
- Utilisateurs
- Parametres

## 6. Base de donnees recommandee

Tables principales :

- users
- roles
- students
- trainers
- courses
- course_modules
- academic_years
- groups
- enrollments
- payments
- attendance_sessions
- attendance_records
- evaluations
- grades
- documents
- settings

## 7. Champs principaux par table

### students

- id
- matricule
- first_name
- last_name
- gender
- birth_date
- birth_place
- phone
- email
- address
- emergency_contact_name
- emergency_contact_phone
- status
- created_at
- updated_at

### courses

- id
- code
- name
- duration
- description
- registration_fee
- training_fee
- monthly_fee
- status
- created_at
- updated_at

### groups

- id
- course_id
- academic_year_id
- trainer_id
- name
- start_date
- end_date
- capacity
- status
- created_at
- updated_at

### enrollments

- id
- student_id
- course_id
- group_id
- enrollment_date
- total_amount
- discount_amount
- final_amount
- status
- created_at
- updated_at

### payments

- id
- enrollment_id
- student_id
- receipt_number
- amount
- payment_method
- payment_reason
- payment_date
- received_by
- created_at
- updated_at

### attendance_sessions

- id
- group_id
- course_module_id
- trainer_id
- session_date
- topic
- created_at
- updated_at

### attendance_records

- id
- attendance_session_id
- student_id
- status
- comment
- created_at
- updated_at

### evaluations

- id
- group_id
- course_module_id
- trainer_id
- title
- evaluation_type
- evaluation_date
- max_score
- created_at
- updated_at

### grades

- id
- evaluation_id
- student_id
- score
- appreciation
- created_at
- updated_at

## 8. Regles de gestion importantes

- Un apprenant peut avoir plusieurs inscriptions dans le temps.
- Une inscription appartient a une seule formation et a une seule promotion.
- Un paiement est toujours lie a une inscription.
- Le reste a payer est calcule automatiquement :

  **reste a payer = montant final de l'inscription - total des paiements**

- Une promotion appartient a une formation.
- Une presence est enregistree par date, par classe et par module.
- Les notes sont saisies par evaluation.
- Les suppressions sensibles doivent etre limitees aux administrateurs.

## 9. Ecrans a prevoir

### Ecran de connexion

- email ou nom d'utilisateur ;
- mot de passe ;
- bouton connexion.

### Tableau de bord

- cartes statistiques ;
- graphiques simples ;
- alertes ;
- derniers paiements ;
- dernieres inscriptions.

### Liste des apprenants

- barre de recherche ;
- filtres ;
- bouton ajouter ;
- tableau ;
- actions : voir, modifier, imprimer.

### Fiche apprenant

- informations personnelles ;
- formation actuelle ;
- historique des inscriptions ;
- paiements ;
- presences ;
- notes ;
- documents.

### Paiements

- selection apprenant ;
- inscription concernee ;
- montant ;
- mode de paiement ;
- impression recu.

### Presences

- choix de la classe ;
- choix de la date ;
- liste des apprenants ;
- boutons present, absent, retard, excuse.

### Rapports

- filtre par periode ;
- filtre par formation ;
- export PDF ;
- export Excel.

## 10. Design recommande

Style souhaite :

- professionnel ;
- clair ;
- rapide a utiliser ;
- couleurs sobres ;
- interface adaptee a une administration scolaire.

Couleurs possibles :

- bleu fonce pour la confiance ;
- vert pour les validations ;
- orange pour les alertes ;
- rouge pour les impayes ou absences critiques.

Logo :

- afficher **CFP EREXIT** en haut de l'application ;
- sous-titre : **Centre de Formation Professionnelle**.

## 11. Technologies recommandees

Option conseillee pour une application durable :

- Frontend : React ou Vue.js
- Backend : Laravel, Django ou Node.js
- Base de donnees : MySQL ou PostgreSQL
- PDF : generation automatique cote serveur
- Hebergement : serveur web, VPS ou cloud

Option simple et economique :

- Laravel + MySQL
- Interface responsive
- Hebergement mutualise ou VPS

## 12. Version 1 recommandee

Pour commencer, developper d'abord :

- connexion et roles ;
- tableau de bord ;
- apprenants ;
- formations ;
- promotions ;
- inscriptions ;
- paiements ;
- recus PDF ;
- presences ;
- rapports simples.

## 13. Version 2 possible

Apres la premiere version :

- notes et releves ;
- attestations PDF ;
- portail apprenant ;
- notifications SMS ou WhatsApp ;
- sauvegarde automatique ;
- exports Excel avances ;
- suivi des depenses du centre ;
- gestion des emplois du temps.

## 14. Priorites de developpement

1. Base de donnees
2. Authentification et roles
3. Gestion des apprenants
4. Gestion des formations
5. Inscriptions
6. Paiements et recus
7. Presences
8. Rapports
9. Notes et documents

## 15. Resultat attendu

A la fin, CFP EREXIT doit disposer d'une application capable de :

- centraliser toutes les donnees du centre ;
- eviter les pertes d'information ;
- suivre les paiements et les impayes ;
- imprimer les documents importants ;
- faciliter le travail du secretariat, de la comptabilite et de la direction ;
- donner une image plus professionnelle au centre.

