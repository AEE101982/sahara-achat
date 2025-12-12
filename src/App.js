import React, { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Package,
  Bell,
  LogIn,
  LogOut,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { supabase } from './supabaseClient';

/* ================= TELEGRAM ================= */
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
  unite_mesure: '',
  photo: null,
  photo_url: null
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const [articles, setArticles] = useState([{ ...EMPTY_ARTICLE }]);
  const [formData, setFormData] = useState({
    date_demande: new Date().toISOString().split('T')[0],
    departement_concerner: '',
    date_livraison_souhaitee: '',
    urgent: false
  });

  /* ================= SESSION - VERSION SIMPLIFIÉE ================= */
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        console.log('Initialisation de l\'authentification...');
        
        // Vérifier la session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Erreur session:', error);
          if (isMounted) {
            setIsAuthenticated(false);
            setCurrentUser(null);
            setLoading(false);
          }
          return;
        }

        if (!session) {
          console.log('Aucune session trouvée');
          if (isMounted) {
            setIsAuthenticated(false);
            setCurrentUser(null);
            setLoading(false);
          }
          return;
        }

        console.log('Session trouvée:', session.user.email);
        await handleUserSession(session.user);
      } catch (error) {
        console.error('Erreur initialisation:', error);
        if (isMounted) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setLoading(false);
        }
      }
    };

    initAuth();

    // Écouter les changements d'authentification
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event);
        
        if (!isMounted) return;

        if (!session) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setRequests([]);
          setLoading(false);
          return;
        }

        await handleUserSession(session.user);
      }
    );

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const handleUserSession = async (user) => {
    try {
      console.log('Traitement de l\'utilisateur:', user.email);
      
      // Récupérer le profil
      let role = 'magasinier';
      let nom = user.email;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, nom')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileError && profile) {
        role = profile.role || role;
        nom = profile.nom || nom;
      }

      console.log('Profil récupéré:', { role, nom });

      // Mettre à jour l'état de l'utilisateur
      setCurrentUser({ ...user, role, nom });
      setIsAuthenticated(true);

      // Charger les données
      await loadUserData(role, user.id);

    } catch (error) {
      console.error('Erreur handleUserSession:', error);
      setIsAuthenticated(false);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async (role, userId) => {
    try {
      console.log('Chargement des données pour:', role, userId);
      
      // Charger les demandes
      await loadRequests(role, userId);
      
      // Charger les notifications
      await loadNotifications(role);
      
      // S'abonner aux mises à jour
      subscribeRealtime(role, userId);
      
    } catch (error) {
      console.error('Erreur loadUserData:', error);
    }
  };

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
    try {
      let query = supabase
        .from('requests')
        .select('*');

      if (role === 'magasinier') {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      
      console.log('Demandes chargées:', data?.length || 0);
      setRequests(data || []);
    } catch (error) {
      console.error('Erreur chargement demandes:', error);
      setRequests([]);
    }
  };

  const loadNotifications = async (role) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('type', role)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Erreur chargement notifications:', error);
    }
  };

  /* ================= REALTIME ================= */
  const subscribeRealtime = (role, userId) => {
    try {
      const channel = supabase.channel('requests-channel')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'requests'
          },
          (payload) => {
            // Filtrer pour les magasiniers
            if (role === 'magasinier' && payload.new?.user_id !== userId) {
              return;
            }

            setRequests(current => {
              const index = current.findIndex(r => r.id === payload.new?.id);
              
              switch (payload.eventType) {
                case 'INSERT':
                  return [payload.new, ...current];
                case 'UPDATE':
                  if (index !== -1) {
                    const updated = [...current];
                    updated[index] = payload.new;
                    return updated;
                  }
                  return current;
                case 'DELETE':
                  return current.filter(r => r.id !== payload.old?.id);
                default:
                  return current;
              }
            });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (error) {
      console.error('Erreur abonnement temps réel:', error);
    }
  };

  /* ================= AUTH ================= */
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginForm.username,
        password: loginForm.password
      });
      
      if (error) throw error;
    } catch (error) {
      console.error('Erreur connexion:', error);
      alert('Identifiants incorrects');
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Erreur déconnexion:', error);
    }
  };

  /* ================= SUBMIT REQUEST ================= */
  const handleSubmitRequest = async () => {
    if (submitting) return;
    
    if (!formData.departement_concerner.trim()) {
      alert('Veuillez saisir le département concerné');
      return;
    }

    const validArticles = articles.filter(a => a.designation.trim());
    if (validArticles.length === 0) {
      alert('Veuillez ajouter au moins un article avec une désignation');
      return;
    }

    setSubmitting(true);

    try {
      const articlesWithoutPhotos = validArticles.map(a => ({
        designation: a.designation.trim(),
        quantite: a.quantite || '1',
        unite_mesure: a.unite_mesure || '',
        photo_url: null
      }));

      const requestData = {
        date_demande: formData.date_demande,
        departement_concerner: formData.departement_concerner.trim(),
        date_livraison_souhaitee: formData.date_livraison_souhaitee || null,
        user_id: currentUser.id,
        articles: articlesWithoutPhotos,
        statut: 'En attente',
        urgent: formData.urgent
      };

      const { data: newRequest, error: insertError } = await supabase
        .from('requests')
        .insert([requestData])
        .select()
        .single();

      if (insertError) throw insertError;

      alert('✅ Demande envoyée avec succès !');
      
      // Réinitialiser le formulaire
      setArticles([{ ...EMPTY_ARTICLE }]);
      setFormData({
        date_demande: new Date().toISOString().split('T')[0],
        departement_concerner: '',
        date_livraison_souhaitee: '',
        urgent: false
      });

      // Recharger les demandes
      await loadRequests(currentUser.role, currentUser.id);

    } catch (error) {
      console.error('Erreur soumission demande:', error);
      alert('❌ Erreur lors de l\'envoi de la demande');
    } finally {
      setSubmitting(false);
    }
  };

  /* ================= LOGIN UI ================= */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-lg">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 p-4">
        <form
          onSubmit={handleLogin}
          className="bg-white w-full max-w-sm rounded-2xl p-8 space-y-6 shadow-2xl"
        >
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Connexion</h1>
            <p className="text-gray-600">Accédez à votre espace</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <input 
                type="email" 
                required 
                placeholder="Adresse email"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              />
            </div>
            <div>
              <input 
                type="password" 
                required 
                placeholder="Mot de passe"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              />
            </div>
          </div>
          
          <button 
            type="submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg flex justify-center items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <LogIn size={20} /> 
            <span>Se connecter</span>
          </button>
        </form>
      </div>
    );
  }

  /* ================= MAIN UI ================= */
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 bg-white shadow-sm p-4 flex justify-between items-center z-10">
        <div>
          <p className="font-bold text-lg text-gray-900">{currentUser?.nom}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">
            {currentUser?.role}
          </p>
        </div>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        >
          <LogOut size={18} />
          <span className="hidden sm:inline">Déconnexion</span>
        </button>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        {/* ===== MAGASINIER ===== */}
        {currentUser?.role === 'magasinier' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <ShoppingCart className="text-indigo-600" />
                Nouvelle demande d'achat
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date de demande
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    value={formData.date_demande}
                    onChange={e => setFormData({ ...formData, date_demande: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Département concerné *
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Production, Maintenance, etc."
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    value={formData.departement_concerner}
                    onChange={e => setFormData({ ...formData, departement_concerner: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date livraison souhaitée
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    value={formData.date_livraison_souhaitee}
                    onChange={e => setFormData({ ...formData, date_livraison_souhaitee: e.target.value })}
                  />
                </div>
                <div className="flex items-center">
                  <label className="flex items-center space-x-2 p-3 border border-gray-300 rounded-lg w-full h-full cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600"
                      checked={formData.urgent}
                      onChange={e => setFormData({ ...formData, urgent: e.target.checked })}
                    />
                    <span className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="text-red-500" size={18} />
                      Demande Urgente
                    </span>
                  </label>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <h3 className="font-bold text-gray-900">Articles demandés</h3>
                
                {articles.map((article, index) => (
                  <div key={index} className="border border-gray-200 rounded-xl p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium text-gray-900">
                        Article {index + 1}
                      </h4>
                      {articles.length > 1 && (
                        <button
                          onClick={() => setArticles(p => p.filter((_, idx) => idx !== index))}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Supprimer
                        </button>
                      )}
                    </div>

                    <input
                      placeholder="Désignation *"
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      value={article.designation}
                      onChange={e => {
                        const newArticles = [...articles];
                        newArticles[index].designation = e.target.value;
                        setArticles(newArticles);
                      }}
                      required
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <input
                          placeholder="Quantité"
                          type="number"
                          min="1"
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          value={article.quantite}
                          onChange={e => {
                            const newArticles = [...articles];
                            newArticles[index].quantite = e.target.value;
                            setArticles(newArticles);
                          }}
                        />
                      </div>
                      <div>
                        <input
                          placeholder="Unité de mesure (kg, L, Pièces, etc.)"
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          value={article.unite_mesure}
                          onChange={e => {
                            const newArticles = [...articles];
                            newArticles[index].unite_mesure = e.target.value;
                            setArticles(newArticles);
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Photo (optionnel)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        className="w-full p-2 border border-gray-300 rounded-lg"
                        onChange={e => {
                          const newArticles = [...articles];
                          newArticles[index].photo = e.target.files[0];
                          setArticles(newArticles);
                        }}
                      />
                      {article.photo && (
                        <div className="mt-2">
                          <img
                            src={URL.createObjectURL(article.photo)}
                            alt="Preview"
                            className="h-32 w-auto object-cover rounded-lg border"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setArticles([...articles, { ...EMPTY_ARTICLE }])}
                  className="px-6 py-3 border-2 border-indigo-600 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  + Ajouter un autre article
                </button>
                
                <button
                  onClick={handleSubmitRequest}
                  disabled={submitting}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-6 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Envoi en cours...' : '📤 Envoyer la demande'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Historique des demandes</h3>
              {requests.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucune demande pour le moment
                </p>
              ) : (
                <div className="space-y-3">
                  {requests.map(request => (
                    <div 
                      key={request.id} 
                      className={`border rounded-lg p-4 hover:bg-gray-50 ${
                        request.urgent ? 'border-red-300 bg-red-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">{request.departement_concerner}</p>
                            {request.urgent && (
                              <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                <AlertTriangle size={12} />
                                URGENT
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            {new Date(request.date_demande).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            Statut : <span className="font-medium">{request.statut}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">
                            {request.articles?.length || 0} article(s)
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== ACHETEUR ===== */}
        {currentUser?.role === 'acheteur' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="text-green-600" />
              Demandes à traiter
            </h2>

            {requests.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl shadow">
                <Package className="mx-auto text-gray-400" size={48} />
                <p className="mt-4 text-gray-600">Aucune demande à traiter</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {requests.map(request => (
                  <div 
                    key={request.id} 
                    className={`bg-white rounded-2xl shadow-lg overflow-hidden ${
                      request.urgent ? 'border-2 border-red-500' : ''
                    }`}
                  >
                    {request.urgent && (
                      <div className="bg-red-500 text-white p-2 text-center font-bold flex items-center justify-center gap-2">
                        <AlertTriangle size={18} />
                        DEMANDE URGENTE
                        <AlertTriangle size={18} />
                      </div>
                    )}
                    
                    <div className="p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg text-gray-900">
                            {request.departement_concerner}
                          </p>
                          <p className="text-sm text-gray-600">
                            {new Date(request.date_demande).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          request.statut === 'Validé' ? 'bg-green-100 text-green-800' :
                          request.statut === 'Refusé' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {request.statut}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Date livraison souhaitée</p>
                          <p className="font-medium text-gray-900">
                            {request.date_livraison_souhaitee ? 
                              new Date(request.date_livraison_souhaitee).toLocaleDateString() : 
                              'Non spécifiée'}
                          </p>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          request.urgent ? 'bg-red-50' : 'bg-gray-50'
                        }`}>
                          <p className="text-xs text-gray-500">Type de demande</p>
                          <p className={`font-medium ${request.urgent ? 'text-red-700' : 'text-gray-900'}`}>
                            {request.urgent ? 'URGENTE 🚨' : 'Normale'}
                          </p>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <p className="font-medium text-gray-900 mb-3">Articles :</p>
                        <div className="space-y-3">
                          {request.articles?.map((article, idx) => (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3">
                              <p className="font-medium text-gray-900">{article.designation}</p>
                              <div className="flex justify-between text-sm text-gray-600 mt-2">
                                <span>Quantité: {article.quantite || '1'}</span>
                                {article.unite_mesure && (
                                  <span>Unité: {article.unite_mesure}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4 border-t">
                        <button className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2">
                          <CheckCircle size={18} />
                          Valider
                        </button>
                        <button className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700">
                          Refuser
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
