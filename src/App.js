import React, { useState, useEffect } from 'react';
import { ShoppingCart, Package, Bell, Calendar, User, Clock, CheckCircle, AlertCircle, LogIn, LogOut } from 'lucide-react';
import { supabase } from './supabaseClient';

// ═══════════════════════════════════════════════════════════════
// 🔐 CONFIGURATION TELEGRAM - À MODIFIER ICI
// ═══════════════════════════════════════════════════════════════
const TELEGRAM_CONFIG = {
  // Bot pour le Responsable Achats (reçoit les nouvelles demandes)
  acheteurBotToken: '8210812171:AAFac_FmCYkK9d_RIuG0KJof17evWdzP37w',
  acheteurChatId: '7903997817',

  // Bot pour le Magasinier (reçoit les confirmations de délai)
  magasinierBotToken: '8104711488:AAGle7LUvv2YK2wdrDj8eJhRyWiA5HMhtUM',
  magasinierChatId: '7392016731'
};
// ═══════════════════════════════════════════════════════════════

const PurchaseRequestSystem = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [articles, setArticles] = useState([{
    designation: '',
    quantite: '',
    couleur: '',
    dimensions: '',
    prix: '',
    fournisseur: ''
  }]);

  const [formData, setFormData] = useState({
    dateDemande: new Date().toISOString().split('T')[0],
    nomDemandeur: '',
    dateLivraisonSouhaitee: '',
  });

  // ───────── useEffect : session persistante + chargement données ─────────
  useEffect(() => {
    // Charger cache local d'abord (rapide)
    try {
      const savedRequests = JSON.parse(localStorage.getItem('requests') || '[]');
      const savedNotifications = JSON.parse(localStorage.getItem('notifications') || '[]');
      if (Array.isArray(savedRequests) && savedRequests.length) setRequests(savedRequests);
      if (Array.isArray(savedNotifications) && savedNotifications.length) setNotifications(savedNotifications);
    } catch (e) {
      console.warn('Erreur lecture cache local', e);
    }

    // Initialisation session Supabase + récupération profil, requests, notifications
    const init = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;
        if (session?.user) {
          // set user initial
          setCurrentUser(session.user);
          setIsAuthenticated(true);

          // try to fetch profile role/nom
          try {
            const { data: profile, error: profErr } = await supabase
              .from('profiles')
              .select('role, nom')
              .eq('id', session.user.id)
              .single();
            if (!profErr && profile) {
              setCurrentUser(prev => ({ ...session.user, role: profile.role, nom: profile.nom }));
            }
          } catch (e) {
            console.warn('profiles fetch error', e);
          }
        }

        // Fetch requests
        try {
          const { data: reqs, error: reqErr } = await supabase
            .from('requests')
            .select('*')
            .order('dateCreation', { ascending: false });
          if (!reqErr && Array.isArray(reqs)) {
            setRequests(reqs);
            localStorage.setItem('requests', JSON.stringify(reqs));
          }
        } catch (e) {
          console.warn('fetch requests failed', e);
        }

        // Fetch notifications
        try {
          const { data: notifs, error: notifErr } = await supabase
            .from('notifications')
            .select('*')
            .order('id', { ascending: false });
          if (!notifErr && Array.isArray(notifs)) {
            setNotifications(notifs);
            localStorage.setItem('notifications', JSON.stringify(notifs));
          }
        } catch (e) {
          console.warn('fetch notifications failed', e);
        }
      } catch (err) {
        console.error('init error', err);
      }
    };

    init();

    // Écoute des changements de session
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
        setIsAuthenticated(true);

        // récupérer profil si existant
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, nom')
            .eq('id', session.user.id)
            .single();
          if (profile) setCurrentUser(prev => ({ ...session.user, role: profile.role, nom: profile.nom }));
        } catch (e) {
          // ignore
        }
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    });

    return () => {
      if (listener?.subscription) listener.subscription.unsubscribe();
    };
  }, []);

  // ───────── Telegram helper ─────────
  const sendTelegramNotification = async (botToken, chatId, message) => {
    if (!botToken || !chatId || botToken.includes('VOTRE_') || chatId.includes('VOTRE_')) {
      console.log('⚠️ Configuration Telegram non définie dans le code source');
      return;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
      const data = await response.json();
      if (!data.ok) console.error('❌ Erreur Telegram:', data.description);
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de la notification Telegram:', error);
    }
  };

  // ───────── Auth: login / logout (Supabase) ─────────
  const handleLogin = async () => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.username,
        password: loginForm.password,
      });
      if (error) {
        console.error('Login error', error);
        return alert('Identifiants incorrects');
      }
      const user = data.user;
      setCurrentUser(user);
      setIsAuthenticated(true);

      // Récupérer profil role/nom si existant
      try {
        const { data: profile, error: profErr } = await supabase
          .from('profiles')
          .select('role, nom')
          .eq('id', user.id)
          .single();
        if (!profErr && profile) {
          setCurrentUser(prev => ({ ...prev, role: profile.role, nom: profile.nom }));
        } else {
          // si pas de profile, on peut définir nom par email par défaut
          setCurrentUser(prev => ({ ...prev, nom: user.email }));
        }
      } catch (e) {
        console.warn('profile fetch after login failed', e);
        setCurrentUser(prev => ({ ...prev, nom: user.email }));
      }
    } catch (err) {
      console.error('handleLogin unexpected error', err);
      alert('Erreur lors de la connexion');
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Supabase signOut error', e);
    }
    setIsAuthenticated(false);
    setCurrentUser(null);
    setLoginForm({ username: '', password: '' });
  };

  // ───────── Notifications (Supabase first) ─────────
  const addNotification = async (message, type) => {
    const notif = {
      message,
      type,
      date: new Date().toLocaleString('fr-FR'),
      read: false
    };

    // try insert into supabase
    try {
      const { data, error } = await supabase.from('notifications').insert([notif]).select().single();
      if (!error && data) {
        setNotifications(prev => [data, ...prev]);
        localStorage.setItem('notifications', JSON.stringify([data, ...notifications]));
        return;
      }
    } catch (e) {
      console.warn('insert notification supabase failed', e);
    }

    // fallback local
    const localNotif = { id: Date.now(), ...notif };
    setNotifications(prev => [localNotif, ...prev]);
    localStorage.setItem('notifications', JSON.stringify([localNotif, ...notifications]));
  };

  const markNotificationAsRead = async (id) => {
    // try supabase update (if id in supabase)
    try {
      const { data, error } = await supabase.from('notifications').update({ read: true }).eq('id', id).select().single();
      if (!error && data) {
        setNotifications(prev => prev.map(n => n.id === id ? data : n));
        localStorage.setItem('notifications', JSON.stringify(notifications.map(n => n.id === id ? data : n)));
        return;
      }
    } catch (e) {
      console.warn('markNotificationAsRead supabase failed', e);
    }
    // fallback local update
    const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    setNotifications(updated);
    localStorage.setItem('notifications', JSON.stringify(updated));
  };

  const unreadCount = notifications.filter(n =>
    !n.read &&
    ((currentUser?.role === 'magasinier' && n.type === 'magasinier') ||
      (currentUser?.role === 'acheteur' && n.type === 'acheteur'))
  ).length;

  // ───────── Gestion articles ─────────
  const addArticle = () => setArticles([...articles, { designation: '', quantite: '', couleur: '', dimensions: '', prix: '', fournisseur: '' }]);
  const updateArticle = (index, field, value) => { const newArticles = [...articles]; newArticles[index][field] = value; setArticles(newArticles); };
  const removeArticle = (index) => setArticles(articles.filter((_, i) => i !== index));

  // ───────── Soumettre demande (insert supabase) ─────────
  const handleSubmitRequest = async () => {
    if (!formData.nomDemandeur || !formData.dateLivraisonSouhaitee) {
      alert('Veuillez remplir tous les champs obligatoires');
      return;
    }

    // Validation articles
    const invalidArticles = articles.filter(a => a.designation && (!a.quantite || !a.dimensions || !a.prix));
    if (invalidArticles.length > 0) {
      alert('⚠️ Pour chaque article, veuillez remplir : Désignation, Quantité, Dimensions et Prix');
      return;
    }

    const hasValidArticle = articles.some(a => a.designation && a.quantite && a.dimensions && a.prix);
    if (!hasValidArticle) {
      alert('Veuillez ajouter au moins un article complet (Désignation, Quantité, Dimensions, Prix)');
      return;
    }

    const newRequest = {
      ...formData,
      articles: articles.filter(a => a.designation),
      statut: 'En attente',
      delaiLivraisonFournisseur: '',
      dateCreation: new Date().toISOString()
    };

    // Insert into Supabase
    try {
      // If your requests.id is auto-generated (serial/uuid), use .insert([...]).select().single()
      const { data, error } = await supabase.from('requests').insert([newRequest]).select().single();
      if (!error && data) {
        setRequests(prev => [data, ...prev]);
        localStorage.setItem('requests', JSON.stringify([data, ...requests]));
      } else {
        console.warn('Supabase insert request error', error);
        // fallback local
        const localReq = { id: Date.now(), ...newRequest };
        setRequests(prev => [localReq, ...prev]);
        localStorage.setItem('requests', JSON.stringify([localReq, ...requests]));
      }
    } catch (e) {
      console.error('handleSubmitRequest supabase error', e);
      const localReq = { id: Date.now(), ...newRequest };
      setRequests(prev => [localReq, ...prev]);
      localStorage.setItem('requests', JSON.stringify([localReq, ...requests]));
    }

    // Notification interne (insert notification)
    await addNotification(`Nouvelle demande d'achat de ${formData.nomDemandeur}`, 'acheteur');

    // Telegram
    const telegramMessage = `
🔔 <b>Nouvelle Demande d'Achat</b>

👤 <b>Demandeur:</b> ${formData.nomDemandeur}
📅 <b>Date demande:</b> ${formData.dateDemande}
🚚 <b>Livraison souhaitée:</b> ${formData.dateLivraisonSouhaitee}

📦 <b>Articles commandés:</b>
${articles.filter(a => a.designation).map((art, i) => {
      let artText = `${i + 1}. <b>${art.designation}</b>
   • Quantité: ${art.quantite}
   • Dimensions: ${art.dimensions}
   • Prix: ${art.prix} MAD`;
      if (art.couleur) artText += `\n   • Couleur: ${art.couleur}`;
      if (art.fournisseur) artText += `\n   • Fournisseur: ${art.fournisseur}`;
      return artText;
    }).join('\n\n')}

⏰ <i>Demande créée le ${new Date().toLocaleString('fr-FR')}</i>
`.trim();

    sendTelegramNotification(TELEGRAM_CONFIG.acheteurBotToken, TELEGRAM_CONFIG.acheteurChatId, telegramMessage);

    // Reset form
    setArticles([{ designation: '', quantite: '', couleur: '', dimensions: '', prix: '', fournisseur: '' }]);
    setFormData({ dateDemande: new Date().toISOString().split('T')[0], nomDemandeur: '', dateLivraisonSouhaitee: '' });

    alert('✅ Demande d\'achat envoyée avec succès !');
  };

  // ───────── Mettre à jour délai (update supabase) ─────────
  const handleUpdateDelivery = async (requestId, delai) => {
    const request = requests.find(r => r.id === requestId) || {};

    try {
      const { data, error } = await supabase
        .from('requests')
        .update({ delaiLivraisonFournisseur: delai, statut: 'Confirmé' })
        .eq('id', requestId)
        .select()
        .single();

      if (!error && data) {
        setRequests(prev => prev.map(r => r.id === requestId ? data : r));
        localStorage.setItem('requests', JSON.stringify(requests.map(r => r.id === requestId ? data : r)));
      } else {
        console.warn('Supabase update error', error);
        // fallback local update
        const updatedRequests = requests.map(r => r.id === requestId ? { ...r, delaiLivraisonFournisseur: delai, statut: 'Confirmé' } : r);
        setRequests(updatedRequests);
        localStorage.setItem('requests', JSON.stringify(updatedRequests));
      }

      // notification interne
      await addNotification(`Délai de livraison confirmé pour votre commande du ${request.dateDemande || ''}`, 'magasinier');

      // Telegram
      const totalPrix = (request.articles || []).reduce((sum, art) => sum + (parseFloat(art.prix) || 0), 0);
      const telegramMessage = `
✅ <b>Délai de Livraison Confirmé</b>

📦 <b>Votre commande du ${request.dateDemande || ''}</b>

📅 <b>Délai de livraison fournisseur:</b> ${delai}
🚚 <b>Livraison initialement souhaitée:</b> ${request.dateLivraisonSouhaitee || ''}

<b>Articles commandés:</b>
${(request.articles || []).map((art, i) => {
        return `${i + 1}. ${art.designation} - Qté: ${art.quantite} - ${art.dimensions} - ${art.prix} MAD`;
      }).join('\n\n')}

💰 <b>Total estimé:</b> ${totalPrix.toFixed(2)} MAD

✔️ <i>Confirmé par le service achats le ${new Date().toLocaleString('fr-FR')}</i>
`.trim();

      sendTelegramNotification(TELEGRAM_CONFIG.magasinierBotToken, TELEGRAM_CONFIG.magasinierChatId, telegramMessage);
      alert('✅ Délai de livraison mis à jour !');
    } catch (err) {
      console.error('handleUpdateDelivery unexpected error', err);
      alert('❌ Erreur lors de la mise à jour du délai');
    }
  };

  // ───────── Rendu UI (inchangé, responsive) ─────────
  // Page de connexion
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
              <Package className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Système d'Achats</h1>
            <p className="text-gray-600">Connectez-vous pour continuer</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nom d'utilisateur
              </label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Entrez votre nom d'utilisateur"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Entrez votre mot de passe"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={handleLogin}
              className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition shadow-lg flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Se connecter
            </button>
          </div>

          <div className="mt-8 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 font-semibold mb-2"><center>SAHARA MOBILIER</center></p>
            <div className="space-y-1 text-xs text-gray-600">

              <p><center><strong>Copyright-2025</strong></center></p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Interface principale après connexion
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Package className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Système de Gestion des Achats</h1>
                <p className="text-sm text-gray-600">
                  Connecté en tant que: <span className="font-semibold">{currentUser?.nom}</span>
                  <span className="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs rounded-full">
                    {currentUser?.role === 'magasinier' ? '👤 Magasinier' : '💼 Responsable Achats'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 rounded-full hover:bg-gray-100 transition"
                >
                  <Bell className="w-6 h-6 text-gray-600" />
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto">
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-800">Notifications</h3>
                    </div>
                    {notifications
                      .filter(n =>
                        (currentUser?.role === 'magasinier' && n.type === 'magasinier') ||
                        (currentUser?.role === 'acheteur' && n.type === 'acheteur')
                      )
                      .sort((a, b) => b.id - a.id)
                      .map(notif => (
                        <div
                          key={notif.id}
                          onClick={() => markNotificationAsRead(notif.id)}
                          className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                            !notif.read ? 'bg-blue-50' : ''
                          }`}
                        >
                          <p className="text-sm text-gray-800">{notif.message}</p>
                          <p className="text-xs text-gray-500 mt-1">{notif.date}</p>
                        </div>
                      ))}
                    {notifications.filter(n =>
                      (currentUser?.role === 'magasinier' && n.type === 'magasinier') ||
                      (currentUser?.role === 'acheteur' && n.type === 'acheteur')
                    ).length === 0 && (
                      <p className="p-4 text-sm text-gray-500">Aucune notification</p>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Déconnexion
              </button>
            </div>
          </div>
        </div>

        {/* Vue Magasinier */}
        {currentUser?.role === 'magasinier' && (
          <div className="space-y-6">
            {/* Formulaire de demande */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                <ShoppingCart className="w-6 h-6 text-indigo-600" />
                Nouvelle Demande d'Achat
              </h2>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de demande
                    </label>
                    <input
                      type="date"
                      value={formData.dateDemande}
                      onChange={(e) => setFormData({ ...formData, dateDemande: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nom du demandeur <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.nomDemandeur}
                      onChange={(e) => setFormData({ ...formData, nomDemandeur: e.target.value })}
                      placeholder="Nom de la personne qui demande"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de livraison souhaitée <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.dateLivraisonSouhaitee}
                      onChange={(e) => setFormData({ ...formData, dateLivraisonSouhaitee: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    Articles <span className="text-sm text-gray-500">(Champs avec * sont obligatoires)</span>
                  </h3>

                  {articles.map((article, index) => (
                    <div key={index} className="mb-4 p-4 bg-gray-50 rounded-lg border-2 border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Désignation <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: TUBE CARRE"
                            value={article.designation}
                            onChange={(e) => updateArticle(index, 'designation', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Quantité <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            placeholder="Ex: 5"
                            value={article.quantite}
                            onChange={(e) => updateArticle(index, 'quantite', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Dimensions <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: 120x80x75cm"
                            value={article.dimensions}
                            onChange={(e) => updateArticle(index, 'dimensions', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Prix unitaire (MAD) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Ex: 2500.00"
                            value={article.prix}
                            onChange={(e) => updateArticle(index, 'prix', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Couleur
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: Noir"
                            value={article.couleur}
                            onChange={(e) => updateArticle(index, 'couleur', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Fournisseur
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: SOCIETE FOURNISSEUR"
                            value={article.fournisseur}
                            onChange={(e) => updateArticle(index, 'fournisseur', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div className="flex items-end">
                          {articles.length > 1 && (
                            <button
                              onClick={() => removeArticle(index)}
                              className="w-full px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={addArticle}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
                  >
                    + Ajouter un article
                  </button>
                </div>

                <button
                  onClick={handleSubmitRequest}
                  className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition shadow-lg"
                >
                  Envoyer la demande
                </button>
              </div>
            </div>

            {/* Mes demandes */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Mes Demandes</h2>
              <div className="space-y-4">
                {requests.map(request => {
                  const totalPrix = (request.articles || []).reduce((sum, art) => sum + (parseFloat(art.prix) || 0), 0);
                  return (
                    <div key={request.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-gray-800">Demande du {request.dateDemande}</p>
                          <p className="text-sm text-gray-600">Pour: <span className="font-semibold">{request.nomDemandeur}</span></p>
                          <p className="text-sm text-gray-600">Livraison souhaitée: {request.dateLivraisonSouhaitee}</p>
                          <p className="text-sm font-semibold text-indigo-600 mt-1">Total: {totalPrix.toFixed(2)} MAD</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                          request.statut === 'Confirmé'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {request.statut}
                        </span>
                      </div>

                      <div className="text-sm text-gray-600 mb-2">
                        <strong>Articles:</strong>
                        { (request.articles || []).map((art, i) => (
                          <div key={i} className="ml-4 mt-2 p-2 bg-gray-50 rounded">
                            <div className="font-medium">• {art.designation}</div>
                            <div className="ml-4 text-xs text-gray-500">
                              Qté: {art.quantite} | Dimensions: {art.dimensions} | Prix: {art.prix} MAD
                              {art.couleur && ` | Couleur: ${art.couleur}`}
                              {art.fournisseur && ` | Fournisseur: ${art.fournisseur}`}
                            </div>
                          </div>
                        ))}
                      </div>

                      {request.delaiLivraisonFournisseur && (
                        <div className="mt-3 p-3 bg-green-50 rounded-lg flex items-center gap-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <span className="text-sm text-green-800">
                            <strong>Délai fournisseur:</strong> {request.delaiLivraisonFournisseur}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {requests.length === 0 && (
                  <p className="text-gray-500 text-center py-8">Aucune demande pour le moment</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Vue Responsable Achats */}
        {currentUser?.role === 'acheteur' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Package className="w-6 h-6 text-indigo-600" />
              Demandes d'Achat à Traiter
            </h2>

            <div className="space-y-4">
              {requests.map(request => {
                const totalPrix = (request.articles || []).reduce((sum, art) => sum + (parseFloat(art.prix) || 0), 0);
                return (
                  <div key={request.id} className="border-2 border-gray-200 rounded-lg p-6 hover:shadow-lg transition">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <User className="w-5 h-5 text-gray-600" />
                          <p className="font-bold text-lg text-gray-800">{request.nomDemandeur}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            Demande: {request.dateDemande}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            Livraison: {request.dateLivraisonSouhaitee}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-indigo-700 mt-2">
                          💰 Total estimé: {totalPrix.toFixed(2)} MAD
                        </p>
                      </div>
                      <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                        request.statut === 'Confirmé'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {request.statut}
                      </span>
                    </div>

                    <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                      <strong className="text-gray-800 block mb-3">Articles commandés:</strong>
                      <div className="space-y-3">
                        {(request.articles || []).map((art, i) => (
                          <div key={i} className="p-3 bg-white rounded border border-gray-200">
                            <div className="font-semibold text-gray-800 mb-2">
                              {i + 1}. {art.designation}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-gray-600">
                              <div>
                                <span className="font-medium">Quantité:</span> {art.quantite}
                              </div>
                              <div>
                                <span className="font-medium">Dimensions:</span> {art.dimensions}
                              </div>
                              <div className="text-indigo-700 font-semibold">
                                <span className="font-medium">Prix:</span> {art.prix} MAD
                              </div>
                              {art.couleur && (
                                <div>
                                  <span className="font-medium">Couleur:</span> {art.couleur}
                                </div>
                              )}
                              {art.fournisseur && (
                                <div>
                                  <span className="font-medium">Fournisseur:</span> {art.fournisseur}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {!request.delaiLivraisonFournisseur ? (
                      <div className="flex gap-3">
                        <input
                          type="date"
                          placeholder="Délai de livraison fournisseur"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          onChange={(e) => {
                            const input = e.target;
                            input.dataset.value = e.target.value;
                          }}
                        />
                        <button
                          onClick={(e) => {
                            const input = e.target.previousElementSibling;
                            if (input.dataset.value) {
                              handleUpdateDelivery(request.id, input.dataset.value);
                            } else {
                              alert('Veuillez sélectionner une date');
                            }
                          }}
                          className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition shadow"
                        >
                          Confirmer le délai
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 bg-green-50 rounded-lg flex items-center gap-2">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                        <span className="text-green-800 font-medium">
                          Délai confirmé: {request.delaiLivraisonFournisseur}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {requests.length === 0 && (
                <div className="text-center py-12">
                  <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">Aucune demande d'achat pour le moment</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PurchaseRequestSystem;
