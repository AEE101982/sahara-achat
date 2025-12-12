import React, { useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart,
  Package,
  Bell,
  LogIn,
  LogOut,
  CheckCircle
} from 'lucide-react';
import { supabase } from './supabaseClient';

/* ================= TELEGRAM (INCHANGÉ) ================= */
const TELEGRAM_CONFIG = {
  acheteurBotToken: '8210812171:AAFac_FmCYk9d_RIuG0KJof17evWdzP37w',
  acheteurChatId: '7903997817',
  magasinierBotToken: '8104711488:AAGle7LUvv2YK2wdrDj8eJhRyWiA5HMhtUM',
  magasinierChatId: '7392016731'
};

const EMPTY_ARTICLE = {
  designation: '',
  quantite: '',
  dimensions: '',
  prix: ''
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

    setCurrentUser({ ...user, role, nom });
    setIsAuthenticated(true);

    await loadRequests(role, user.id);
    await loadNotifications(role);
    subscribeRealtime(role, user.id);
  };

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
    let query = supabase
      .from('requests')
      .select('*')
      .order('datecreation', { ascending: false });

    if (role === 'magasinier') {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (!error) setRequests(data || []);
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
    supabase.removeAllChannels();

    supabase.channel('rt-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, p => {
        const r = p.new;
        if (role === 'magasinier' && r.user_id !== userId) return;
        setRequests(prev => [r, ...prev.filter(x => x.id !== r.id)]);
      }).subscribe();

    supabase.channel('rt-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, p => {
        if (p.new.type === role) {
          setNotifications(prev => [p.new, ...prev]);
        }
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
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications]
  );

  const markNotificationAsRead = async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(p => p.map(n => n.id === id ? { ...n, read: true } : n));
  };

  /* ================= ARTICLES ================= */
  const addArticle = () => setArticles(p => [...p, { ...EMPTY_ARTICLE }]);
  const updateArticle = (i, f, v) =>
    setArticles(p => { const c = [...p]; c[i][f] = v; return c; });
  const removeArticle = (i) => setArticles(p => p.filter((_, idx) => idx !== i));

  /* ================= SUBMIT REQUEST ================= */
  const handleSubmitRequest = async () => {
    const valid = articles.filter(a => a.designation && a.quantite && a.dimensions && a.prix);
    if (!valid.length) return alert('Articles incomplets');

    const totalGeneral = valid.reduce(
      (s, a) => s + (parseFloat(a.prix) || 0) * (parseFloat(a.quantite) || 1), 0
    );

    await supabase.from('requests').insert([{
      ...formData,
      user_id: currentUser.id,
      articles: valid,
      totalGeneral,
      statut: 'En attente'
    }]);

    setArticles([{ ...EMPTY_ARTICLE }]);
  };

  /* ================= LOGIN UI ================= */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-700 p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
          className="bg-white w-full max-w-sm rounded-xl p-6 space-y-4"
        >
          <h1 className="text-2xl font-bold text-center">Connexion</h1>
          <input type="email" required placeholder="Email"
            className="w-full p-3 border rounded-lg"
            onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
          />
          <input type="password" required placeholder="Mot de passe"
            className="w-full p-3 border rounded-lg"
            onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
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
      {/* HEADER */}
      <div className="sticky top-0 bg-white shadow p-4 flex justify-between">
        <div>
          <p className="font-bold">{currentUser.nom}</p>
          <p className="text-xs">{currentUser.role}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowNotifications(!showNotifications)}>
            <Bell />
            {unreadCount > 0 && <span className="text-red-500">{unreadCount}</span>}
          </button>
          <button onClick={handleLogout}><LogOut /></button>
        </div>
      </div>

      {/* NOTIFICATIONS */}
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

      {/* ================= VUE MAGASINIER ================= */}
      {currentUser.role === 'magasinier' && (
        <div className="p-4 space-y-4">
          <div className="bg-white p-4 rounded-xl shadow">
            <h2 className="font-bold mb-2">🛒 Nouvelle demande</h2>
            {articles.map((a, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 mb-2">
                <input placeholder="Désignation" className="border p-2"
                  onChange={e => updateArticle(i, 'designation', e.target.value)} />
                <input placeholder="Quantité" className="border p-2"
                  onChange={e => updateArticle(i, 'quantite', e.target.value)} />
              </div>
            ))}
            <button onClick={addArticle} className="text-sm text-indigo-600">+ Article</button>
            <button onClick={handleSubmitRequest}
              className="mt-3 w-full bg-indigo-600 text-white py-2 rounded">
              Envoyer
            </button>
          </div>

          <div className="bg-white p-4 rounded-xl shadow">
            <h2 className="font-bold mb-2">📦 Mes demandes</h2>
            {requests.map(r => (
              <div key={r.id} className="border p-2 mb-2 rounded">
                <p className="font-semibold">{r.nomDemandeur}</p>
                <p className="text-sm">💰 {r.totalGeneral?.toFixed(2)} MAD</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= VUE ACHETEUR ================= */}
      {currentUser.role === 'acheteur' && (
        <div className="p-4 space-y-4">
          <h2 className="font-bold text-lg">📋 Demandes à traiter</h2>
          {requests.map(r => (
            <div key={r.id} className="bg-white p-4 rounded-xl shadow">
              <p className="font-bold">{r.nomDemandeur}</p>
              <p className="text-sm">💰 {r.totalGeneral?.toFixed(2)} MAD</p>
              <p className="text-xs">Statut : {r.statut}</p>
              {r.delaiLivraisonFournisseur && (
                <div className="text-green-600 flex items-center gap-2">
                  <CheckCircle /> {r.delaiLivraisonFournisseur}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
