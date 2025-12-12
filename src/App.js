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

/* ================= ARTICLE MODEL ================= */
const EMPTY_ARTICLE = {
  designation: '',
  quantite: '',
  dimensions: '',
  prix: '',
  photo: null,
  photo_url: null
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

  /* ================= SESSION ================= */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) hydrateUser(data.session.user);
    });

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

    loadRequests(role, user.id);
    loadNotifications(role);
    subscribeRealtime(role, user.id);
  };

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
    let q = supabase
      .from('requests')
      .select('*')
      .order('datecreation', { ascending: false });

    if (role === 'magasinier') q = q.eq('user_id', userId);

    const { data } = await q;
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
    supabase.removeAllChannels();

    supabase.channel('rt-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, p => {
        const r = p.new;
        if (role === 'magasinier' && r.user_id !== userId) return;
        setRequests(prev => [r, ...prev.filter(x => x.id !== r.id)]);
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

  /* ================= ARTICLES ================= */
  const addArticle = () => setArticles(p => [...p, { ...EMPTY_ARTICLE }]);
  const updateArticle = (i, f, v) =>
    setArticles(p => {
      const c = [...p];
      c[i][f] = v;
      return c;
    });
  const removeArticle = (i) =>
    setArticles(p => p.filter((_, idx) => idx !== i));

  /* ================= PHOTO UPLOAD ================= */
  const uploadArticlePhoto = async (file, requestId, index) => {
    const ext = file.name.split('.').pop();
    const path = `articles/${requestId}_${index}.${ext}`;

    const { error } = await supabase
      .storage
      .from('articles')
      .upload(path, file, { upsert: true });

    if (error) return null;

    const { data } = supabase
      .storage
      .from('articles')
      .getPublicUrl(path);

    return data.publicUrl;
  };

  /* ================= SUBMIT REQUEST ================= */
  const handleSubmitRequest = async () => {
    const prepared = [];

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      if (!a.designation) continue;

      let photo_url = null;
      if (a.photo) {
        photo_url = await uploadArticlePhoto(a.photo, currentUser.id, i);
      }

      prepared.push({
        designation: a.designation,
        quantite: a.quantite,
        dimensions: a.dimensions,
        prix: a.prix,
        photo_url
      });
    }

    if (!prepared.length) return alert('Aucun article valide');

    const totalGeneral = prepared.reduce(
      (s, a) => s + (parseFloat(a.prix) || 0) * (parseFloat(a.quantite) || 1), 0
    );

    await supabase.from('requests').insert([{
      ...formData,
      user_id: currentUser.id,
      articles: prepared,
      totalGeneral,
      statut: 'En attente'
    }]);

    setArticles([{ ...EMPTY_ARTICLE }]);
    alert('Demande envoyée');
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
      <div className="sticky top-0 bg-white shadow p-4 flex justify-between">
        <div>
          <p className="font-bold">{currentUser.nom}</p>
          <p className="text-xs">{currentUser.role}</p>
        </div>
        <button onClick={handleLogout}><LogOut /></button>
      </div>

      {/* ===== MAGASINIER ===== */}
      {currentUser.role === 'magasinier' && (
        <div className="p-4 space-y-4">
          <div className="bg-white p-4 rounded-xl shadow">
            <h2 className="font-bold mb-3">🛒 Nouvelle demande</h2>

            {articles.map((a, i) => (
              <div key={i} className="border p-3 rounded-lg mb-3 space-y-2">
                <input placeholder="Désignation" className="border p-2 w-full"
                  onChange={e => updateArticle(i, 'designation', e.target.value)} />

                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Quantité" type="number" className="border p-2"
                    onChange={e => updateArticle(i, 'quantite', e.target.value)} />
                  <input placeholder="Prix" type="number" className="border p-2"
                    onChange={e => updateArticle(i, 'prix', e.target.value)} />
                </div>

                <input placeholder="Dimensions" className="border p-2 w-full"
                  onChange={e => updateArticle(i, 'dimensions', e.target.value)} />

                <input type="file" accept="image/*"
                  onChange={e => updateArticle(i, 'photo', e.target.files[0])} />

                {a.photo && (
                  <img src={URL.createObjectURL(a.photo)}
                    alt="preview"
                    className="h-24 object-cover rounded" />
                )}

                {articles.length > 1 && (
                  <button onClick={() => removeArticle(i)}
                    className="bg-red-500 text-white w-full py-2 rounded">
                    ❌ Supprimer cette ligne
                  </button>
                )}
              </div>
            ))}

            <button onClick={addArticle} className="text-indigo-600 text-sm">
              + Ajouter une ligne
            </button>

            <button onClick={handleSubmitRequest}
              className="mt-4 w-full bg-indigo-600 text-white py-3 rounded">
              Envoyer la demande
            </button>
          </div>
        </div>
      )}

      {/* ===== ACHETEUR ===== */}
      {currentUser.role === 'acheteur' && (
        <div className="p-4 space-y-4">
          {requests.map(r => (
            <div key={r.id} className="bg-white p-4 rounded-xl shadow">
              <p className="font-bold">{r.nomDemandeur}</p>
              <p className="text-sm">💰 {r.totalGeneral?.toFixed(2)} MAD</p>
              <p className="text-xs">Statut : {r.statut}</p>

              {r.articles?.map((a, i) => (
                <div key={i} className="text-xs mt-2">
                  • {a.designation}
                  {a.photo_url && (
                    <img src={a.photo_url}
                      alt=""
                      className="h-20 mt-1 rounded" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
