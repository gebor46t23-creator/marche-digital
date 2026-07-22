-- =========================================================
-- SCHÉMA MARCHÉ.DIGITAL — à exécuter dans Supabase > SQL Editor
-- =========================================================

-- Profils (infos complémentaires liées à un utilisateur Supabase Auth)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'buyer',     -- 'buyer' ou 'seller'
  plan text not null default 'commission', -- 'commission' | 'sub_monthly' | 'sub_yearly'
  created_at timestamptz default now()
);

-- Produits
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  desc text,
  cat text not null,
  price integer not null,
  file_url text,
  created_at timestamptz default now()
);

-- Ventes (une ligne = un achat confirmé)
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete set null,
  buyer_id uuid references profiles(id) on delete set null,
  seller_id uuid not null references profiles(id) on delete cascade,
  price integer not null,
  commission integer not null default 0,
  net integer not null,
  transaction_id text unique,
  created_at timestamptz default now()
);

-- Retraits
create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id) on delete cascade,
  seller_name text,
  amount integer not null,
  dest text not null,
  status text not null default 'payé',
  created_at timestamptz default now()
);

-- Intentions de paiement en attente (créées avant redirection vers
-- CinetPay, consommées par le webhook une fois le paiement confirmé)
create table if not exists pending_payments (
  transaction_id text primary key,
  product_id uuid references products(id) on delete set null,
  buyer_id uuid references profiles(id) on delete set null,
  amount integer not null,
  created_at timestamptz default now()
);

-- Cette table n'est manipulée que par les fonctions serveur (clé
-- service_role, qui contourne RLS) : pas de policy publique nécessaire.
alter table pending_payments enable row level security;

-- =========================================================
-- SÉCURITÉ (Row Level Security)
-- =========================================================
alter table profiles enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table withdrawals enable row level security;

-- Profils : lecture publique (noms affichés), écriture par le propriétaire uniquement
create policy "profiles lisibles par tous" on profiles for select using (true);
create policy "profil modifiable par son propriétaire" on profiles for update using (auth.uid() = id);
create policy "profil créable par son propriétaire" on profiles for insert with check (auth.uid() = id);

-- Produits : lecture publique, écriture réservée au vendeur propriétaire
create policy "produits lisibles par tous" on products for select using (true);
create policy "produits créables par le vendeur" on products for insert with check (auth.uid() = seller_id);
create policy "produits supprimables par le vendeur" on products for delete using (auth.uid() = seller_id);

-- Ventes : le vendeur voit ses ventes ; l'INSERT se fait uniquement via le
-- webhook de paiement (clé "service role", qui contourne RLS) — jamais
-- directement depuis le navigateur, pour éviter qu'un acheteur ne
-- s'auto-déclare une vente sans avoir payé.
create policy "ventes visibles par le vendeur concerné" on sales for select using (auth.uid() = seller_id);

-- Retraits : le vendeur gère ses propres retraits
create policy "retraits visibles par le vendeur" on withdrawals for select using (auth.uid() = seller_id);
create policy "retraits créables par le vendeur" on withdrawals for insert with check (auth.uid() = seller_id);
