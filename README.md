# Marché.digital — guide de mise en ligne

## 1. Créer le projet Supabase (base de données + comptes)
1. Va sur https://supabase.com → crée un projet gratuit.
2. Dans **SQL Editor**, colle et exécute le contenu de `supabase-schema.sql`.
3. Dans **Authentication > Providers**, désactive "Confirm email" pour l'instant (plus simple pour tester ; réactive-le avant l'ouverture réelle au public).
4. Dans **Project Settings > Data API / API Keys**, note :
   - `Project URL` (dans "Data API")
   - clé `Publishable key` (`sb_publishable_...`, dans "API Keys")
   - clé `Secret key` (`sb_secret_...`, dans "API Keys" — ⚠️ secrète, ne jamais la mettre dans `index.html`)

   *(Note : Supabase a renommé "anon" en "Publishable key" et "service_role" en "Secret key" — mêmes rôles, nouveaux noms.)*
5. Ouvre `index.html`, remplace `SUPABASE_URL` et `SUPABASE_ANON_KEY` en haut du script par tes vraies valeurs.

## 2. Créer le compte CinetPay (paiement)
1. Crée un compte marchand sur https://cinetpay.com.
2. Récupère ta `apikey` et ton `site_id` dans le tableau de bord CinetPay.

## 3. Déployer sur Netlify
1. Pousse ce dossier (avec `netlify/functions/`, `netlify.toml`, `package.json`, `index.html`) sur un dépôt GitHub.
2. Sur https://app.netlify.com → "Add new site" → "Import an existing project" → connecte ton dépôt.
3. Dans **Site settings > Environment variables**, ajoute :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CINETPAY_APIKEY`
   - `CINETPAY_SITE_ID`
   - `ADMIN_CODE` (le code secret de ton choix pour accéder au panneau Administration — remplace l'ancien code en clair)
4. Déploie. Netlify installera automatiquement `@supabase/supabase-js` pour les fonctions grâce à `package.json`.

## 4. Configurer le webhook CinetPay
Dans ton tableau de bord CinetPay, renseigne l'URL de notification :
`https://TON-SITE.netlify.app/.netlify/functions/payment-webhook`
(la fonction `payment.js`, action `init`, la transmet aussi automatiquement à chaque paiement).

## Ce qui est réel vs simulé
- ✅ **Réel** : comptes utilisateurs (Supabase Auth), base de données partagée, publication de produits, initialisation de paiement CinetPay, confirmation de vente via webhook serveur (sécurisé, ne dépend pas du navigateur), panneau Administration protégé par un code stocké côté serveur.
- ⚠️ **Encore simplifié** :
  - Le **retrait des gains** enregistre juste une demande "payée" en base — l'envoi réel de l'argent vers Mobile Money nécessite l'API de *payout* CinetPay/FedaPay (différente de l'API de paiement), à ajouter dans une fonction serveur dédiée.
  - "Continuer avec Google" fonctionne dès que tu actives le provider Google dans Supabase (Authentication > Providers), avec un identifiant OAuth Google Cloud gratuit.
