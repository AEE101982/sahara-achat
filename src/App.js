import React, { useEffect, useMemo, useState } from 'react';
import { Bell, LogIn, LogOut, CheckCircle } from 'lucide-react';
import { supabase } from './supabaseClient';

/* ================= TELEGRAM (INCHANGÉ) ================= */
const TELEGRAM_CONFIG = {
  acheteurBotToken: '8210812171:AAFac_FmCYkK9d_RIuG0KJof17evWdzP37w',
  acheteurChatId: '7903997817',
  magasinierBotToken: '8104711488:AAGle7LUvv2YK2wdrDj8eJhRyWiA5HMhtUM',
  magasinierChatId: '7392016731'
};

const EMPTY_ARTICLE = {
  designation: '',
  quantite: '',
  dimensions: '',
  prix: '',
  couleur: '',
  fournisseur: ''
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const [articles, setArticles] = useState([{ ...EMPTY_ARTICLE }]);
  const [formData, setFormData] = useState({
    dateDemande: new Date().toISOString().split('T')[0],
    nomDemandeur: '',
    dateLivraisonSouhaitee: ''
  });

  /* ================= SAFE HYDRATE USER ================= */
  const hydrateUser = async (user) => {
    let role = 'magasinier';
    let nom = user.email;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, nom')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      role = profile.role || role;
      nom = profile.nom || nom;
    }

    const safeUser = { ...user, role, nom };
    setCurrentUser(safeUser);
    setIsAuthenticated(true);

    await loadRequests(role, user.id);
    await loadNotifications(role);
    subscribeRealtime(role, user.id);
  };

  /* ================= INIT SESSION ================= */
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) hydrateUser(data.session.user);
    };
    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session?.user) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setRequests([]);
      } else {
        hydrateUser(session.user);
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
  let query = supabase
    .from('requests')
    .select('*')
    .order('dateCreation', { ascending: false });

  if (role === 'magasinier') {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Erreur loadRequests:', error);
    return;
  }

  setRequests(data || []);
};

  const loadNotifications = async (role) => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('type', role)
      .order('id', { ascending: false });
    setNotifications(data || []);
  };

  /* ================= REALTIME ================= */
  const subscribeRealtime = (role, userId) => {
    supabase.channel('rt-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, p => {
        if (role === 'magasinier' && p.new.user_id !== userId) return;
        setRequests(prev => [p.new, ...prev.filter(x => x.id !== p.new.id)]);
      }).subscribe();
  };

  /* ================= AUTH ================= */
  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.username,
      password: loginForm.password
    });
    if (error) alert('Identifiants incorrects');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  /* ================= NOTIFS ================= */
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const markNotificationAsRead = async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  /* ================= SUBMIT REQUEST ================= */
  const handleSubmitRequest = async () => {
    const valid = articles.filter(a => a.designation && a.quantite && a.dimensions && a.prix);
    if (!valid.length) return alert('Articles incomplets');

    const totalGeneral = valid.reduce(
      (s, a) => s + (parseFloat(a.prix) || 0) * (parseFloat(a.quantite) || 1),
      0
    );

    await supabase.from('requests').insert([{
      ...formData,
      user_id: currentUser.id,
      articles: valid,
      totalGeneral,
      statut: 'En attente',
      dateCreation: new Date().toISOString()
    }]);

    await fetch(`https://api.telegram.org/bot${TELEGRAM_CONFIG.acheteurBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CONFIG.acheteurChatId,
        text: `🛒 Nouvelle demande d'achat\n👤 ${formData.nomDemandeur}\n💰 ${totalGeneral.toFixed(2)} MAD`
      })
    });

    setArticles([{ ...EMPTY_ARTICLE }]);
  };

  /* ================= LOGIN ================= */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-700 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
          className="bg-white w-full max-w-sm rounded-xl p-6 space-y-4"
        >
          <h1 className="text-2xl font-bold text-center">Connexion</h1>

          <input
            type="email"
            required
            placeholder="Email"
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
          />

          <input
            type="password"
            required
            placeholder="Mot de passe"
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
          />

          <button className="w-full bg-indigo-600 text-white py-3 rounded-lg flex justify-center gap-2">
            <LogIn /> Connexion
          </button>
        </form>
      </div>
    );
  }

  /* ================= MAIN UI ================= */
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-white shadow p-4 flex justify-between">
        <div>
          <p className="font-bold">{currentUser?.nom}</p>
          <p className="text-xs">{currentUser?.role}</p>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setShowNotifications(!showNotifications)}>
            <Bell />
            {unreadCount > 0 && <span className="text-red-500">{unreadCount}</span>}
          </button>
          <button onClick={handleLogout}><LogOut /></button>
        </div>
      </div>

      {showNotifications && (
        <div className="p-4">
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => markNotificationAsRead(n.id)}
              className={`p-3 rounded ${n.read ? 'bg-white' : 'bg-indigo-100'}`}
            >
              {n.message}
            </div>
          ))}
        </div>
      )}

      <div className="p-4 space-y-4">
        {requests.map(r => (
          <div key={r.id} className="bg-white p-4 rounded shadow">
            <p className="font-bold">{r.nomDemandeur}</p>
            <p>💰 {r.totalGeneral?.toFixed(2)} MAD</p>

            {r.delaiLivraisonFournisseur && (
              <div className="text-green-600 flex items-center gap-2 mt-2">
                <CheckCircle /> {r.delaiLivraisonFournisseur}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
