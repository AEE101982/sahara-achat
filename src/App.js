import React, { useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart,
  Package,
  Bell,
  Calendar,
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  LogIn,
  LogOut
} from 'lucide-react';
import { supabase } from './supabaseClient';

/* ============================================================
   🔐 CONFIGURATION TELEGRAM — INCHANGÉE
============================================================ */
const TELEGRAM_CONFIG = {
  acheteurBotToken: '8210812171:AAFac_FmCYkK9d_RIuG0KJof17evWdzP37w',
  acheteurChatId: '7903997817',
  magasinierBotToken: '8104711488:AAGle7LUvv2YK2wdrDj8eJhRyWiA5HMhtUM',
  magasinierChatId: '7392016731'
};

/* ============================================================
   CONSTANTES
============================================================ */
const EMPTY_ARTICLE = {
  designation: '',
  quantite: '',
  couleur: '',
  dimensions: '',
  prix: '',
  fournisseur: ''
};

/* ============================================================
   APP
============================================================ */
export default function PurchaseRequestSystem() {
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

  /* ============================================================
     INIT SESSION + PROFIL
  ============================================================ */
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (session?.user) {
        setIsAuthenticated(true);

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, nom')
          .eq('id', session.user.id)
          .single();

        setCurrentUser({ ...session.user, ...profile });

        await loadRequests(profile?.role, session.user.id);
        await loadNotifications(profile?.role);
        subscribeRealtime(profile?.role, session.user.id);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session?.user) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setRequests([]);
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, nom')
          .eq('id', session.user.id)
          .single();

        setIsAuthenticated(true);
        setCurrentUser({ ...session.user, ...profile });

        await loadRequests(profile?.role, session.user.id);
        await loadNotifications(profile?.role);
        subscribeRealtime(profile?.role, session.user.id);
      }
    );

    return () => {
      listener?.subscription?.unsubscribe();
      supabase.removeAllChannels();
    };
  }, []);

  /* ============================================================
     LOADERS (SUPABASE = SOURCE DE VÉRITÉ)
  ============================================================ */
  const loadRequests = async (role, userId) => {
    let query = supabase
      .from('requests')
      .select('*')
      .order('dateCreation', { ascending: false });

    if (role === 'magasinier') {
      query = query.eq('user_id', userId);
    }

    const { data } = await query;
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

  /* ============================================================
     REALTIME SUPABASE
  ============================================================ */
  const subscribeRealtime = (role, userId) => {
    supabase.removeAllChannels();

    supabase
      .channel('realtime-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requests' },
        (payload) => {
          const newRow = payload.new;

          if (role === 'magasinier' && newRow.user_id !== userId) return;

          setRequests((prev) => {
            const filtered = prev.filter((r) => r.id !== newRow.id);
            return [newRow, ...filtered];
          });
        }
      )
      .subscribe();

    supabase
      .channel('realtime-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          if (payload.new.type === role) {
            setNotifications((prev) => [payload.new, ...prev]);
          }
        }
      )
      .subscribe();
  };

  /* ============================================================
     TELEGRAM
  ============================================================ */
  const sendTelegramNotification = async (botToken, chatId, message) => {
    if (!botToken || !chatId) return;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
  };

  /* ============================================================
     AUTH
  ============================================================ */
  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.username,
      password: loginForm.password
    });

    if (error) return alert('Identifiants incorrects');

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, nom')
      .eq('id', data.user.id)
      .single();

    setCurrentUser({ ...data.user, ...profile });
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setRequests([]);
  };

  /* ============================================================
     NOTIFICATIONS
  ============================================================ */
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markNotificationAsRead = async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const addNotification = async (message, type) => {
    await supabase.from('notifications').insert([
      { message, type, read: false }
    ]);
  };

  /* ============================================================
     ARTICLES
  ============================================================ */
  const addArticle = () => setArticles((p) => [...p, { ...EMPTY_ARTICLE }]);
  const updateArticle = (i, f, v) =>
    setArticles((p) => {
      const c = [...p];
      c[i][f] = v;
      return c;
    });
  const removeArticle = (i) =>
    setArticles((p) => p.filter((_, idx) => idx !== i));

  /* ============================================================
     SUBMIT REQUEST
  ============================================================ */
  const handleSubmitRequest = async () => {
    const validArticles = articles.filter(
      (a) => a.designation && a.quantite && a.dimensions && a.prix
    );
    if (!validArticles.length) return alert('Articles incomplets');

    const totalGeneral = validArticles.reduce(
      (s, a) =>
        s +
        (parseFloat(a.prix) || 0) * (parseFloat(a.quantite) || 1),
      0
    );

    const { data } = await supabase
      .from('requests')
      .insert([
        {
          ...formData,
          user_id: currentUser.id,
          articles: validArticles,
          totalGeneral,
          statut: 'En attente',
          dateCreation: new Date().toISOString()
        }
      ])
      .select()
      .single();

    setRequests((p) => [data, ...p]);

    await addNotification(
      `Nouvelle demande d'achat de ${formData.nomDemandeur}`,
      'acheteur'
    );

    sendTelegramNotification(
      TELEGRAM_CONFIG.acheteurBotToken,
      TELEGRAM_CONFIG.acheteurChatId,
      `🛒 Nouvelle demande d'achat de ${formData.nomDemandeur}`
    );

    setArticles([{ ...EMPTY_ARTICLE }]);
  };

  /* ============================================================
     UPDATE DELIVERY
  ============================================================ */
  const handleUpdateDelivery = async (id, delai) => {
    const { data } = await supabase
      .from('requests')
      .update({ delaiLivraisonFournisseur: delai, statut: 'Confirmé' })
      .eq('id', id)
      .select()
      .single();

    setRequests((p) => p.map((r) => (r.id === id ? data : r)));

    await addNotification('Délai confirmé', 'magasinier');

    sendTelegramNotification(
      TELEGRAM_CONFIG.magasinierBotToken,
      TELEGRAM_CONFIG.magasinierChatId,
      `✅ Délai confirmé : ${delai}`
    );
  };

  /* ============================================================
     UI — LOGIN
  ============================================================ */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="bg-white p-8 rounded-xl w-full max-w-md shadow-2xl">
          <h1 className="text-3xl font-bold text-center mb-6">
            Système d’Achats
          </h1>

          <input
            className="w-full mb-3 p-3 border rounded"
            placeholder="Email"
            onChange={(e) =>
              setLoginForm({ ...loginForm, username: e.target.value })
            }
          />
          <input
            type="password"
            className="w-full mb-4 p-3 border rounded"
            placeholder="Mot de passe"
            onChange={(e) =>
              setLoginForm({ ...loginForm, password: e.target.value })
            }
          />

          <button
            onClick={handleLogin}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg flex justify-center gap-2"
          >
            <LogIn /> Connexion
          </button>
        </div>
      </div>
    );
  }

  /* ============================================================
     UI — MAIN
  ============================================================ */
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white p-6 rounded-xl shadow mb-6 flex justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gestion des Achats</h1>
            <p className="text-sm text-gray-600">
              {currentUser?.nom} — {currentUser?.role}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button onClick={() => setShowNotifications(!showNotifications)}>
              <Bell />
              {unreadCount > 0 && (
                <span className="ml-1 text-red-600 font-bold">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={handleLogout}
              className="bg-red-500 text-white px-4 py-2 rounded-lg"
            >
              <LogOut />
            </button>
          </div>
        </div>

        {showNotifications && (
          <div className="bg-white rounded-xl shadow mb-6">
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => markNotificationAsRead(n.id)}
                className={`p-4 border-b cursor-pointer ${
                  !n.read ? 'bg-indigo-50' : ''
                }`}
              >
                {n.message}
              </div>
            ))}
          </div>
        )}

        {currentUser?.role === 'acheteur' &&
          requests.map((r) => {
            const totalPrix = (r.articles || []).reduce(
              (s, a) =>
                s +
                (parseFloat(a.prix) || 0) *
                  (parseFloat(a.quantite) || 1),
              0
            );

            return (
              <div
                key={r.id}
                className="bg-white p-6 rounded-xl shadow mb-4"
              >
                <p className="font-bold">{r.nomDemandeur}</p>
                <p>💰 {totalPrix.toFixed(2)} MAD</p>

                {!r.delaiLivraisonFournisseur && (
                  <button
                    onClick={() =>
                      handleUpdateDelivery(
                        r.id,
                        new Date().toISOString().split('T')[0]
                      )
                    }
                    className="mt-3 bg-green-600 text-white px-4 py-2 rounded-lg"
                  >
                    Confirmer délai
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
