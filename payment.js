/* =========================================================
   Fonction de paiement unique (CinetPay), avec deux rôles
   selon le paramètre ?action= dans l'URL :

   - /.netlify/functions/payment?action=init     → appelée par le
     navigateur pour démarrer un paiement (index.html le fait déjà).
   - /.netlify/functions/payment?action=webhook  → appelée par
     CinetPay pour confirmer un paiement (à renseigner dans ton
     tableau de bord CinetPay comme URL de notification).

   Variables d'environnement Netlify à définir :
     CINETPAY_APIKEY, CINETPAY_SITE_ID,
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (clé "service_role")
   ========================================================= */
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const action = event.queryStringParameters?.action;
  if (action === 'webhook') return handleWebhook(event);
  if (action === 'init') return handleInit(event);
  if (action === 'admin') return handleAdmin(event);
  return { statusCode: 400, body: 'Paramètre ?action=init, ?action=webhook ou ?action=admin requis.' };
};

async function handleAdmin(event) {
  /* Les tables "sales" et "withdrawals" sont protégées par des règles
     de sécurité (RLS) qui n'autorisent chaque vendeur qu'à voir SES
     propres ventes — c'est volontaire, pour la sécurité. Le panneau
     admin doit donc passer par ici, avec la clé service_role (qui
     contourne ces règles), et vérifie un code secret stocké côté
     serveur (variable d'environnement ADMIN_CODE), jamais visible
     dans le code du navigateur. */
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { code } = JSON.parse(event.body);
    if (!process.env.ADMIN_CODE || code !== process.env.ADMIN_CODE) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Code administrateur incorrect.' }) };
    }
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: sales } = await sb.from('sales').select('commission');
    const { data: withdrawals } = await sb.from('withdrawals').select('*').order('created_at', { ascending: false });
    const revenue = (sales || []).reduce((a, s) => a + (s.commission || 0), 0);
    return { statusCode: 200, body: JSON.stringify({ revenue, withdrawals: withdrawals || [] }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

async function handleInit(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { transactionId, productId, amount, description, channel, returnUrl, buyerId } = JSON.parse(event.body);
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // On ne fait jamais confiance au prix envoyé par le navigateur :
    // on récupère le vrai prix du produit en base avant de créer le paiement.
    let verifiedAmount = amount;
    if (productId) {
      const { data: product } = await sb.from('products').select('price').eq('id', productId).single();
      if (product) verifiedAmount = product.price;
    }

    await sb.from('pending_payments').insert({
      transaction_id: transactionId,
      product_id: productId || null,
      buyer_id: buyerId || null,
      amount: verifiedAmount
    });

    const channelMap = { card: 'CREDIT_CARD', orange: 'MOBILE_MONEY', tmoney: 'MOBILE_MONEY', moov: 'MOBILE_MONEY' };

    const res = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_APIKEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: transactionId,
        amount: verifiedAmount,
        currency: 'XOF',
        channels: channelMap[channel] || 'ALL',
        description: description || 'Achat Marché.digital',
        notify_url: `${process.env.URL}/.netlify/functions/payment?action=webhook`,
        return_url: returnUrl
      })
    });
    const data = await res.json();

    if (data.code !== '201') {
      return { statusCode: 400, body: JSON.stringify({ error: data.message || 'Échec CinetPay' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ payment_url: data.data.payment_url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

async function handleWebhook(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const transactionId = body.cpm_trans_id || body.transaction_id;
    if (!transactionId) return { statusCode: 400, body: 'transaction_id manquant' };

    // Vérification du statut réel auprès de CinetPay (obligatoire —
    // ne jamais se fier uniquement au contenu du webhook reçu).
    const checkRes = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_APIKEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: transactionId
      })
    });
    const check = await checkRes.json();
    if (check.data?.status !== 'ACCEPTED') {
      return { statusCode: 200, body: 'Paiement non confirmé, ignoré.' };
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: pending } = await sb.from('pending_payments').select('*').eq('transaction_id', transactionId).single();
    if (!pending) return { statusCode: 200, body: 'Aucune intention de paiement correspondante.' };

    const { data: product } = await sb.from('products').select('*').eq('id', pending.product_id).single();
    if (!product) return { statusCode: 200, body: 'Produit introuvable.' };

    const { data: seller } = await sb.from('profiles').select('*').eq('id', product.seller_id).single();
    const isSub = seller && (seller.plan === 'sub_monthly' || seller.plan === 'sub_yearly');
    const commission = isSub ? 0 : Math.round(product.price * 0.10);
    const net = product.price - commission;

    await sb.from('sales').insert({
      product_id: product.id,
      buyer_id: pending.buyer_id,
      seller_id: product.seller_id,
      price: product.price,
      commission,
      net,
      transaction_id: transactionId
    });

    await sb.from('pending_payments').delete().eq('transaction_id', transactionId);

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Erreur serveur' };
  }
}
