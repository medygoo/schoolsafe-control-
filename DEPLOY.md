# Déploiement de SchoolSafe Control App

Stack recommandée : **Render.com** (hébergement) + **Neon.tech** (PostgreSQL gratuit).

## 1. Créer la base de données Neon

1. Va sur https://neon.tech et inscris-toi (gratuit).
2. Crée un nouveau projet.
3. Crée une base de données nommée `schoolsafe_control`.
4. Copie l’URL de connexion PostgreSQL (format `postgresql://user:pass@host/db?sslmode=require`).

## 2. Déployer sur Render

1. Va sur https://render.com et connecte ton compte GitHub.
2. Crée un nouveau **Web Service** à partir du dépôt `medygoo/schoolsafemm`.
3. Sélectionne le répertoire racine : `control-app/`.
4. Render détectera automatiquement le `Dockerfile`.
5. Dans les variables d’environnement, ajoute :
   - `DATABASE_URL` = l’URL Neon copiée à l’étape 1
   - `ADMIN_TOKEN` = un token fort de minimum 16 caractères (ex: `ss-admin-TOKEN-2026-SECURE`)
6. Clique sur **Create Web Service**.

## 3. Récupérer l’URL et le token

- Render te donne une URL du type `https://schoolsafe-control-app.onrender.com`.
- Note le `ADMIN_TOKEN` quelque part de sûr (il est nécessaire pour se connecter au tableau de bord).

## 4. Utiliser l’app centrale

Ouvre l’URL Render dans ton navigateur et connecte-toi avec le `ADMIN_TOKEN`.

Fonctionnalités disponibles :
- créer/gérer les écoles (instances) ;
- révoquer les tokens de setup et HMAC ;
- bloquer/débloquer une école ;
- voir les demandes d’impression de cartes ;
- télécharger les images recto/verso depuis R2 ;
- marquer une demande comme imprimée ou échouée.

## 5. Connecter une école (VPS SchoolSafe V2)

Dans l’app centrale, crée une instance pour l’école. Récupère :
- `setup_token` : à utiliser lors de la première configuration de SchoolSafe V2.
- `hmac_secret` : à configurer dans les variables d’environnement du VPS école :
  - `CONTROL_APP_URL=https://schoolsafe-control-app.onrender.com`
  - `CONTROL_APP_INSTANCE_ID=<id de l’instance>`
  - `CONTROL_APP_HMAC_SECRET=<hmac_secret>`

## Notes importantes

- Le plan gratuit Render met le service en veille après 15 min d’inactivité : la première requête prend 30–60 s.
- Neon reste actif tant qu’il reçoit des requêtes régulièrement.
- Ne jamais committer `ADMIN_TOKEN` ou `DATABASE_URL`.
