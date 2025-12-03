import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ShoppingCart, Package, Bell, Calendar, User, Clock, CheckCircle, AlertCircle, LogIn, LogOut, Plus, Trash2 } from 'lucide-react';

const TELEGRAM_CONFIG = {
  acheteurBotToken: '8210812171:AAFac_FmCYkK9d_RIuG0KJof17evWdzP37w',
  acheteurChatId: '7903997817',
  magasinierBotToken: '8104711488:AAGle7LUvv2YK2wdrDj8eJhRyWiA5HMhtUM',
  magasinierChatId: '7392016731'
};

const PurchaseRequestSystem = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [articles, setArticles] = useState([{ designation: '', quantite: '', couleur: '', dimensions: '', prix: '', fournisseur: '' }]);
  const [formData, setFormData] = useState({
    dateDemande: new Date().toISOString().split('T')[0],
    nomDemandeur: '',
    dateLivraisonSouhaitee: '',
  });

  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const savedRequests = JSON.parse(localStorage.getItem('requests') || '[]');
    const savedNotifications = JSON.parse(localStorage.getItem('notifications') || '[]');
    setRequests(savedRequests);
    setNotifications(savedNotifications);

    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const user = session.user;
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, nom')
          .eq('id', user.id)
          .single();
        if (profile) {
          setCurrentUser({ ...user, role: profile.role, nom: profile.nom });
          setIsAuthenticated(true);
        }
      }
    };
    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const fetchProfile = async () => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, nom')
            .eq('id', session.user.id)
            .single();
          if (profile) {
            setCurrentUser({ ...session.user, role: profile.role, nom: profile.nom });
            setIsAuthenticated(true);
          }
        };
        fetchProfile();
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const sendTelegramNotification = async (botToken, chatId, message) => {
    if (!botToken || !chatId || botToken.includes('VOTRE_') || chatId.includes('VOTRE_')) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
      const data = await res.json();
      if (!data.ok) console.error('Erreur Telegram:', data.description);
    } catch (err) { console.error(err); }
  };

  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.username,
      password: loginForm.password
    });
    if (error) return alert('Identifiants incorrects');
    setCurrentUser(data.user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setLoginForm({ username: '', password: '' });
  };

  const addNotification = (message, type) => {
    const newNotif = { id: Date.now(), message, type, date: new Date().toLocaleString('fr-FR'), read: false };
    const updatedNotifications = [...notifications, newNotif];
    setNotifications(updatedNotifications);
    localStorage.setItem('notifications', JSON.stringify(updatedNotifications));
  };

  const markNotificationAsRead = (id) => {
    const updatedNotifications = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    setNotifications(updatedNotifications);
    localStorage.setItem('notifications', JSON.stringify(updatedNotifications));
  };

  const unreadCount = notifications.filter(n =>
    !n.read && ((currentUser?.role === 'magasinier' && n.type === 'magasinier') ||
               (currentUser?.role === 'acheteur' && n.type === 'acheteur'))
  ).length;

  // ═══════════════════════════════════════════════════════════════
  const addArticle = () => setArticles([...articles, { designation: '', quantite: '', couleur: '', dimensions: '', prix: '', fournisseur: '' }]);
  const updateArticle = (i, field, value) => { const copy = [...articles]; copy[i][field] = value; setArticles(copy); };
  const removeArticle = i => setArticles(articles.filter((_, idx) => idx !== i));

  const handleSubmitRequest = () => {
    if (!formData.nomDemandeur || !formData.dateLivraisonSouhaitee) return alert('Veuillez remplir tous les champs obligatoires');
    const invalidArticles = articles.filter(a => a.designation && (!a.quantite || !a.dimensions || !a.prix));
    if (invalidArticles.length) return alert('Chaque article doit avoir Désignation, Quantité, Dimensions et Prix');
    if (!articles.some(a => a.designation && a.quantite && a.dimensions && a.prix)) return alert('Ajoutez au moins un article complet');

    const newRequest = { id: Date.now(), ...formData, articles: articles.filter(a => a.designation), statut: 'En attente', delaiLivraisonFournisseur: '', dateCreation: new Date().toISOString() };
    const updatedRequests = [...requests, newRequest];
    setRequests(updatedRequests);
    localStorage.setItem('requests', JSON.stringify(updatedRequests));

    addNotification(`Nouvelle demande d'achat de ${formData.nomDemandeur}`, 'acheteur');

    const telegramMessage = `
🔔 <b>Nouvelle Demande d'Achat</b>
👤 <b>Demandeur:</b> ${formData.nomDemandeur}
📅 <b>Date demande:</b> ${formData.dateDemande}
🚚 <b>Livraison souhaitée:</b> ${formData.dateLivraisonSouhaitee}
📦 <b>Articles:</b>
${articles.filter(a => a.designation).map((art, i) => {
  let artText = `${i + 1}. <b>${art.designation}</b> • Qté: ${art.quantite} • Dimensions: ${art.dimensions} • Prix: ${art.prix} MAD`;
  if (art.couleur) artText += `\n   • Couleur: ${art.couleur}`;
  if (art.fournisseur) artText += `\n   • Fournisseur: ${art.fournisseur}`;
  return artText;
}).join('\n\n')}
⏰ <i>Demande créée le ${new Date().toLocaleString('fr-FR')}</i>`.trim();

    sendTelegramNotification(TELEGRAM_CONFIG.acheteurBotToken, TELEGRAM_CONFIG.acheteurChatId, telegramMessage);

    setArticles([{ designation: '', quantite: '', couleur: '', dimensions: '', prix: '', fournisseur: '' }]);
    setFormData({ dateDemande: new Date().toISOString().split('T')[0], nomDemandeur: '', dateLivraisonSouhaitee: '' });

    alert('✅ Demande d\'achat envoyée avec succès !');
  };

  const handleUpdateDelivery = (requestId, delai) => {
    const request = requests.find(r => r.id === requestId);
    const updatedRequests = requests.map(r => r.id === requestId ? { ...r, delaiLivraisonFournisseur: delai, statut: 'Confirmé' } : r);
    setRequests(updatedRequests);
    localStorage.setItem('requests', JSON.stringify(updatedRequests));

    addNotification(`Délai confirmé pour la commande du ${request.dateDemande}`, 'magasinier');

    const totalPrix = request.articles.reduce((sum, art) => sum + (parseFloat(art.prix) || 0), 0);
    const telegramMessage = `
✅ <b>Délai Confirmé</b>
📦 Commande du ${request.dateDemande}
📅 Délai fournisseur: ${delai}
🚚 Livraison souhaitée: ${request.dateLivraisonSouhaitee}
Articles:
${request.articles.map((art,i)=>`${i+1}. ${art.designation} - Qté:${art.quantite} ${art.dimensions} - ${art.prix} MAD`).join('\n')}
💰 Total estimé: ${totalPrix.toFixed(2)} MAD
✔️ Confirmé par le service achats le ${new Date().toLocaleString('fr-FR')}`.trim();

    sendTelegramNotification(TELEGRAM_CONFIG.magasinierBotToken, TELEGRAM_CONFIG.magasinierChatId, telegramMessage);

    alert('✅ Délai de livraison mis à jour !');
  };

  // ═══════════════════════════════════════════════════════════════
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
              <Package className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Système d'Achats</h1>
            <p className="text-gray-600">Connectez-vous pour continuer</p>
          </div>
          <div className="space-y-4">
            <input type="text" placeholder="Email" value={loginForm.username}
              onChange={e => setLoginForm({...loginForm, username: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
            <input type="password" placeholder="Mot de passe" value={loginForm.password}
              onChange={e => setLoginForm({...loginForm, password: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
            <button onClick={handleLogin} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center justify-center gap-2">
              <LogIn className="w-5 h-5"/> Se connecter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-indigo-600" />
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-800">Système de Gestion des Achats</h1>
              <p className="text-sm text-gray-600">
                Connecté en tant que: <span className="font-semibold">{currentUser.nom}</span>
                <span className="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs rounded-full">
                  {currentUser.role === 'magasinier' ? '👤 Magasinier' : '💼 Responsable Achats'}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-2 rounded-full hover:bg-gray-100">
                <Bell className="w-6 h-6 text-gray-600"/>
                {unreadCount > 0 && <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{unreadCount}</span>}
              </button>
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto">
                  <div className="p-4 border-b border-gray-200"><h3 className="font-semibold text-gray-800">Notifications</h3></div>
                  {notifications.filter(n => (currentUser.role === 'magasinier' && n.type === 'magasinier') || (currentUser.role === 'acheteur' && n.type === 'acheteur'))
                    .sort((a,b)=>b.id-a.id)
                    .map(n => (
                      <div key={n.id} onClick={()=>markNotificationAsRead(n.id)} className={`p-3 border-b cursor-pointer ${!n.read ? 'bg-blue-50' : ''}`}>{n.message}<div className="text-xs text-gray-500 mt-1">{n.date}</div></div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleLogout} className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-1"><LogOut className="w-4 h-4"/> Déconnexion</button>
          </div>
        </div>

        {/* Section Acheteur */}
        {currentUser.role === 'acheteur' && (
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <h2 className="text-lg font-bold mb-4">Nouvelle Demande d'Achat</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input type="text" placeholder="Nom du demandeur" value={formData.nomDemandeur} onChange={e => setFormData({...formData, nomDemandeur: e.target.value})} className="border p-2 rounded-lg w-full" />
              <input type="date" placeholder="Date livraison souhaitée" value={formData.dateLivraisonSouhaitee} onChange={e => setFormData({...formData, dateLivraisonSouhaitee: e.target.value})} className="border p-2 rounded-lg w-full" />
            </div>
            <h3 className="font-semibold mb-2">Articles</h3>
            {articles.map((art,i)=>(
              <div key={i} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-2 p-2 border rounded-lg items-end">
                <input type="text" placeholder="Désignation" value={art.designation} onChange={e=>updateArticle(i,'designation',e.target.value)} className="border p-1 rounded-lg"/>
                <input type="number" placeholder="Quantité" value={art.quantite} onChange={e=>updateArticle(i,'quantite',e.target.value)} className="border p-1 rounded-lg"/>
                <input type="text" placeholder="Dimensions" value={art.dimensions} onChange={e=>updateArticle(i,'dimensions',e.target.value)} className="border p-1 rounded-lg"/>
                <input type="number" placeholder="Prix" value={art.prix} onChange={e=>updateArticle(i,'prix',e.target.value)} className="border p-1 rounded-lg"/>
                <input type="text" placeholder="Couleur" value={art.couleur} onChange={e=>updateArticle(i,'couleur',e.target.value)} className="border p-1 rounded-lg"/>
                <input type="text" placeholder="Fournisseur" value={art.fournisseur} onChange={e=>updateArticle(i,'fournisseur',e.target.value)} className="border p-1 rounded-lg"/>
                <button onClick={()=>removeArticle(i)} className="bg-red-500 text-white p-1 rounded-lg flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
              </div>
            ))}
            <button onClick={addArticle} className="flex items-center gap-2 bg-green-500 text-white px-3 py-1 rounded-lg mb-4"><Plus className="w-4 h-4"/> Ajouter un article</button>
            <button onClick={handleSubmitRequest} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">Envoyer la demande</button>
          </div>
        )}

        {/* Section Magasinier */}
        {currentUser.role === 'magasinier' && (
          <div className="bg-white p-4 rounded-lg shadow-lg overflow-x-auto">
            <h2 className="text-lg font-bold mb-4">Demandes d'Achat</h2>
            <table className="min-w-full border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">Demandeur</th>
                  <th className="border p-2">Date demande</th>
                  <th className="border p-2">Articles</th>
                  <th className="border p-2">Statut</th>
                  <th className="border p-2">Délai fournisseur</th>
                  <th className="border p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req=>(
                  <tr key={req.id} className="border-b">
                    <td className="border p-2">{req.nomDemandeur}</td>
                    <td className="border p-2">{req.dateDemande}</td>
                    <td className="border p-2">
                      {req.articles.map((a,i)=>(<div key={i}>{i+1}. {a.designation} ({a.quantite})</div>))}
                    </td>
                    <td className="border p-2">{req.statut}</td>
                    <td className="border p-2">
                      <input type="text" value={req.delaiLivraisonFournisseur} onChange={e=>handleUpdateDelivery(req.id, e.target.value)} className="border p-1 rounded-lg w-full"/>
                    </td>
                    <td className="border p-2">
                      <button onClick={()=>handleUpdateDelivery(req.id, req.delaiLivraisonFournisseur)} className="bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700">Confirmer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
};

export default PurchaseRequestSystem;
