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
  const [tableSchema, setTableSchema] = useState(null);

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const [articles, setArticles] = useState([{ ...EMPTY_ARTICLE }]);
  // Utiliser le bon nom de colonne basé sur le schéma détecté
  const [formData, setFormData] = useState({
    // Le nom réel sera déterminé par detectTableSchema()
    date_demande: new Date().toISOString().split('T')[0],
    departement_concerner: '',
    date_livraison_souhaitee: '',
    urgent: false
  });

  /* ================= DÉTECTER LE SCHÉMA DE LA TABLE ================= */
  const detectTableSchema = async () => {
    try {
      console.log('Détection du schéma de la table requests...');
      
      // Méthode 1: Vérifier les colonnes via une requête SELECT limitée
      const { data: sampleData, error: sampleError } = await supabase
        .from('requests')
        .select('*')
        .limit(1);
      
      if (!sampleError && sampleData && sampleData.length > 0) {
        const firstRow = sampleData[0];
        console.log('Structure détectée:', Object.keys(firstRow));
        
        // Trouver le nom correct de la colonne date
        const dateColumns = Object.keys(firstRow).filter(key => 
          key.toLowerCase().includes('date') && key.toLowerCase().includes('demande')
        );
        
        if (dateColumns.length > 0) {
          console.log('Colonne date trouvée:', dateColumns[0]);
          return {
            dateColumn: dateColumns[0],
            departementColumn: Object.keys(firstRow).find(key => 
              key.toLowerCase().includes('departement') || key.toLowerCase().includes('nom')
            ) || 'departement_concerner',
            livraisonColumn: Object.keys(firstRow).find(key => 
              key.toLowerCase().includes('livraison') || key.toLowerCase().includes('souhaitee')
            ) || 'date_livraison_souhaitee'
          };
        }
      }
      
      // Méthode 2: Essayer avec des noms communs
      console.log('Essai avec des noms de colonnes courants...');
      return {
        dateColumn: 'date_demande',
        departementColumn: 'departement',
        livraisonColumn: 'date_livraison'
      };
      
    } catch (error) {
      console.error('Erreur détection schéma:', error);
      return {
        dateColumn: 'date_demande',
        departementColumn: 'departement_concerner',
        livraisonColumn: 'date_livraison_souhaitee'
      };
    }
  };

  /* ================= SESSION ================= */
  useEffect(() => {
    const initApp = async () => {
      try {
        // Détecter le schéma de la table
        const schema = await detectTableSchema();
        setTableSchema(schema);
        console.log('Schéma détecté:', schema);

        // Vérifier l'authentification
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          await hydrateUser(session.user);
        } else {
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
      } catch (error) {
        console.error('Erreur initialisation:', error);
      } finally {
        setLoading(false);
      }
    };

    initApp();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Changement auth:', event);
        
        if (session) {
          await hydrateUser(session.user);
        } else {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setRequests([]);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const hydrateUser = async (user) => {
    try {
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
    } catch (error) {
      console.error('Erreur hydratation:', error);
    }
  };

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
    try {
      let query = supabase.from('requests').select('*');

      if (role === 'magasinier') {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) {
        console.error('Erreur chargement demandes:', error);
        // Essayer sans le tri si created_at n'existe pas
        const { data: data2, error: error2 } = await query;
        if (error2) throw error2;
        setRequests(data2 || []);
      } else {
        setRequests(data || []);
      }
    } catch (error) {
      console.error('Erreur critique chargement demandes:', error);
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

  /* ================= TELEGRAM NOTIFICATION ================= */
  const sendTelegramNotification = async (requestData) => {
    try {
      const botToken = TELEGRAM_CONFIG.acheteurBotToken;
      const chatId = TELEGRAM_CONFIG.acheteurChatId;

      const urgentEmoji = requestData.urgent ? '🚨 ' : '';
      const urgentText = requestData.urgent ? '(URGENT) ' : '';
      
      const articlesText = requestData.articles?.map((article, idx) => 
        `${idx + 1}. ${article.designation} - ${article.quantite} ${article.unite_mesure || ''}`
      ).join('\n') || 'Aucun article';

      const message = `${urgentEmoji}*NOUVELLE DEMANDE ${urgentText}*
      
*Département:* ${requestData.departement_concerner}
*Date demande:* ${requestData.date_demande}
*Date souhaitée:* ${requestData.date_livraison_souhaitee || 'Non spécifiée'}
*Urgent:* ${requestData.urgent ? 'OUI 🚨' : 'Non'}

*Articles:*
${articlesText}

${urgentEmoji}${urgentEmoji}${urgentText}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });
    } catch (error) {
      console.error('Erreur envoi Telegram:', error);
    }
  };

  /* ================= AUTH ================= */
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: loginForm.username,
        password: loginForm.password
      });
      
      if (error) throw error;
    } catch (error) {
      console.error('Erreur connexion:', error);
      alert('Identifiants incorrects');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Erreur déconnexion:', error);
    }
  };

  /* ================= ARTICLES ================= */
  const addArticle = () => setArticles(p => [...p, { ...EMPTY_ARTICLE }]);
  
  const updateArticle = (index, field, value) => {
    setArticles(p => {
      const updated = [...p];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeArticle = (index) => {
    if (articles.length > 1) {
      setArticles(p => p.filter((_, idx) => idx !== index));
    }
  };

  /* ================= PHOTO UPLOAD (FACULTATIF) ================= */
  const uploadArticlePhoto = async (file, requestId, index) => {
    if (!file) return null;
    
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}_${index}.${ext}`;
      const path = `articles/${requestId}/${fileName}`;

      const { error: uploadError } = await supabase
        .storage
        .from('articles')
        .upload(path, file, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        console.error('Erreur upload:', uploadError);
        return null;
      }

      const { data: { publicUrl } } = supabase
        .storage
        .from('articles')
        .getPublicUrl(path);

      return publicUrl;
    } catch (error) {
      console.error('Erreur upload photo:', error);
      return null;
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
      // Préparer les articles
      const articlesWithoutPhotos = validArticles.map(a => ({
        designation: a.designation.trim(),
        quantite: a.quantite || '1',
        unite_mesure: a.unite_mesure || '',
        photo_url: null
      }));

      // Préparer les données avec les bons noms de colonnes
      const requestData = {
        [tableSchema?.dateColumn || 'date_demande']: formData.date_demande,
        [tableSchema?.departementColumn || 'departement_concerner']: formData.departement_concerner.trim(),
        [tableSchema?.livraisonColumn || 'date_livraison_souhaitee']: formData.date_livraison_souhaitee || null,
        user_id: currentUser.id,
        articles: articlesWithoutPhotos,
        statut: 'En attente',
        urgent: formData.urgent
      };

      console.log('Données à insérer:', requestData);

      // Insérer la demande
      const { data: newRequest, error: insertError } = await supabase
        .from('requests')
        .insert([requestData])
        .select()
        .single();

      if (insertError) {
        console.error('Erreur détaillée:', insertError);
        
        // Essayer avec un schéma alternatif
        const fallbackData = {
          dateDemande: formData.date_demande,
          departement: formData.departement_concerner.trim(),
          dateLivraison: formData.date_livraison_souhaitee || null,
          user_id: currentUser.id,
          articles: articlesWithoutPhotos,
          statut: 'En attente',
          urgent: formData.urgent
        };

        console.log('Essai avec schéma alternatif:', fallbackData);
        
        const { data: fallbackRequest, error: fallbackError } = await supabase
          .from('requests')
          .insert([fallbackData])
          .select()
          .single();

        if (fallbackError) {
          console.error('Erreur schéma alternatif:', fallbackError);
          throw fallbackError;
        }

        console.log('Insertion réussie avec schéma alternatif');
      } else {
        console.log('Insertion réussie avec schéma détecté');
      }

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
      alert('❌ Erreur lors de l\'envoi de la demande. Vérifiez la console pour plus de détails.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ================= AFFICHAGE DE LA DATE DE DEMANDE ================= */
  const getDateDisplayValue = (request) => {
    if (!request) return '';
    
    // Essayer différents noms de colonnes
    if (request.date_demande) return request.date_demande;
    if (request.dateDemande) return request.dateDemande;
    if (request.date) return request.date;
    if (request.created_at) return request.created_at.split('T')[0];
    
    return '';
  };

  const getDepartementDisplayValue = (request) => {
    if (!request) return '';
    
    if (request.departement_concerner) return request.departement_concerner;
    if (request.departement) return request.departement;
    if (request.departementConcerner) return request.departementConcerner;
    if (request.nom_demandeur) return request.nom_demandeur;
    
    return '';
  };

  /* ================= LOADING STATE ================= */
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

  /* ================= LOGIN UI ================= */
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
                    className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed"
                    value={formData.date_demande}
                    readOnly
                    disabled
                  />
                  <p className="text-xs text-gray-500 mt-1">Date automatique (non modifiable)</p>
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
                    min={formData.date_demande}
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
                          onClick={() => removeArticle(index)}
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
                      onChange={e => updateArticle(index, 'designation', e.target.value)}
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
                          onChange={e => updateArticle(index, 'quantite', e.target.value)}
                        />
                      </div>
                      <div>
                        <input
                          placeholder="Unité de mesure (kg, L, Pièces, etc.)"
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          value={article.unite_mesure}
                          onChange={e => updateArticle(index, 'unite_mesure', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Photo Upload - Facultatif */}
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Photo (facultatif)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        className="w-full p-2 border border-gray-300 rounded-lg"
                        onChange={e => updateArticle(index, 'photo', e.target.files[0])}
                      />
                      {article.photo && (
                        <div className="mt-2">
                          <p className="text-sm text-gray-600 mb-2">Aperçu :</p>
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
                  onClick={addArticle}
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
                            <p className="font-medium text-gray-900">{getDepartementDisplayValue(request)}</p>
                            {request.urgent && (
                              <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                <AlertTriangle size={12} />
                                URGENT
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            Date: {getDateDisplayValue(request) ? new Date(getDateDisplayValue(request)).toLocaleDateString() : 'Date inconnue'}
                          </p>
                          <p className="text-xs text-gray-500">
                            Statut : <span className="font-medium">{request.statut || 'En attente'}</span>
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
                            {getDepartementDisplayValue(request)}
                          </p>
                          <p className="text-sm text-gray-600">
                            Date: {getDateDisplayValue(request) ? new Date(getDateDisplayValue(request)).toLocaleDateString() : 'Date inconnue'}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          request.statut === 'Validé' ? 'bg-green-100 text-green-800' :
                          request.statut === 'Refusé' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {request.statut || 'En attente'}
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
