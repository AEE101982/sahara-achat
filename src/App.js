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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
    const initializeSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          await hydrateUser(data.session.user);
        }
      } catch (error) {
        console.error('Erreur initialisation session:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeSession();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session?.user) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setRequests([]);
      } else {
        await hydrateUser(session.user);
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  const hydrateUser = async (user) => {
    try {
      let role = 'magasinier';
      let nom = user.email;

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, nom')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

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
      console.error('Erreur hydratation utilisateur:', error);
      alert('Erreur de chargement du profil');
    }
  };

  /* ================= LOADERS ================= */
  const loadRequests = async (role, userId) => {
    try {
      let q = supabase
        .from('requests')
        .select('*')
        .order('datecreation', { ascending: false });

      if (role === 'magasinier') {
        q = q.eq('user_id', userId);
      }

      const { data, error } = await q;
      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Erreur chargement demandes:', error);
    }
  };

  const loadNotifications = async (role) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('type', role)
        .order('id', { ascending: false });
      
      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Erreur chargement notifications:', error);
    }
  };

  /* ================= REALTIME ================= */
  const subscribeRealtime = (role, userId) => {
    supabase.removeAllChannels();

    const channel = supabase.channel('rt-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'requests',
          filter: role === 'magasinier' ? `user_id=eq.${userId}` : undefined
        },
        (payload) => {
          const newRequest = payload.new;
          const oldRequest = payload.old;
          
          setRequests(prev => {
            switch (payload.eventType) {
              case 'INSERT':
                return [newRequest, ...prev];
              case 'UPDATE':
                return prev.map(req => 
                  req.id === newRequest.id ? newRequest : req
                );
              case 'DELETE':
                return prev.filter(req => req.id !== oldRequest.id);
              default:
                return prev;
            }
          });
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
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

  /* ================= PHOTO UPLOAD ================= */
  const uploadArticlePhoto = async (file, requestId, index) => {
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

      if (uploadError) throw uploadError;

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
    
    // Validation
    if (!formData.nomDemandeur.trim()) {
      alert('Veuillez saisir votre nom');
      return;
    }

    const validArticles = articles.filter(a => a.designation.trim());
    if (validArticles.length === 0) {
      alert('Veuillez ajouter au moins un article avec une désignation');
      return;
    }

    setSubmitting(true);

    try {
      // Préparer les articles sans photos
      const articlesWithoutPhotos = validArticles.map(a => ({
        designation: a.designation.trim(),
        quantite: a.quantite || '1',
        dimensions: a.dimensions || '',
        prix: a.prix || '0',
        photo_url: null
      }));

      // Calculer le total
      const totalGeneral = articlesWithoutPhotos.reduce(
        (sum, a) => sum + (parseFloat(a.prix) || 0) * (parseFloat(a.quantite) || 1),
        0
      );

      // Insérer la demande initiale
      const { data: newRequest, error: insertError } = await supabase
        .from('requests')
        .insert([{
          ...formData,
          user_id: currentUser.id,
          articles: articlesWithoutPhotos,
          totalGeneral,
          statut: 'En attente',
          datecreation: new Date().toISOString()
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      // Uploader les photos si présentes
      const updatedArticles = [...articlesWithoutPhotos];
      for (let i = 0; i < validArticles.length; i++) {
        if (validArticles[i].photo) {
          const photoUrl = await uploadArticlePhoto(
            validArticles[i].photo,
            newRequest.id,
            i
          );
          if (photoUrl) {
            updatedArticles[i].photo_url = photoUrl;
          }
        }
      }

      // Mettre à jour la demande avec les URLs des photos
      const { error: updateError } = await supabase
        .from('requests')
        .update({ articles: updatedArticles })
        .eq('id', newRequest.id);

      if (updateError) throw updateError;

      // Réinitialiser le formulaire
      setArticles([{ ...EMPTY_ARTICLE }]);
      setFormData({
        dateDemande: new Date().toISOString().split('T')[0],
        nomDemandeur: '',
        dateLivraisonSouhaitee: ''
      });

      alert('✅ Demande envoyée avec succès !');
    } catch (error) {
      console.error('Erreur soumission demande:', error);
      alert('❌ Erreur lors de l\'envoi de la demande');
    } finally {
      setSubmitting(false);
    }
  };

  /* ================= LOADING STATE ================= */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-700">
        <div className="text-white">Chargement...</div>
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
      {/* Header */}
      <header className="sticky top-0 bg-white shadow-sm p-4 flex justify-between items-center z-10">
        <div>
          <p className="font-bold text-lg text-gray-900">{currentUser.nom}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">
            {currentUser.role}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {notifications.length > 0 && (
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 hover:bg-gray-100 rounded-full"
            >
              <Bell size={22} className="text-gray-700" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {notifications.length}
              </span>
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      {/* Notifications Panel */}
      {showNotifications && notifications.length > 0 && (
        <div className="absolute right-4 top-16 bg-white rounded-xl shadow-xl border w-80 z-20 max-h-96 overflow-y-auto">
          <div className="p-4 border-b">
            <h3 className="font-bold text-gray-900">Notifications</h3>
          </div>
          <div className="p-2">
            {notifications.map(notif => (
              <div key={notif.id} className="p-3 hover:bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-800">{notif.message}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(notif.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4">
        {/* ===== MAGASINIER ===== */}
        {currentUser.role === 'magasinier' && (
          <div className="space-y-6">
            {/* Form Section */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <ShoppingCart className="text-indigo-600" />
                Nouvelle demande d'achat
              </h2>

              {/* Form Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date de demande
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    value={formData.dateDemande}
                    onChange={e => setFormData({ ...formData, dateDemande: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom du demandeur
                  </label>
                  <input
                    type="text"
                    placeholder="Votre nom"
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    value={formData.nomDemandeur}
                    onChange={e => setFormData({ ...formData, nomDemandeur: e.target.value })}
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
                    value={formData.dateLivraisonSouhaitee}
                    onChange={e => setFormData({ ...formData, dateLivraisonSouhaitee: e.target.value })}
                  />
                </div>
              </div>

              {/* Articles List */}
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                          placeholder="Prix unitaire (MAD)"
                          type="number"
                          step="0.01"
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          value={article.prix}
                          onChange={e => updateArticle(index, 'prix', e.target.value)}
                        />
                      </div>
                      <div>
                        <input
                          placeholder="Dimensions"
                          className="w-full p-3 border border-gray-300 rounded-lg"
                          value={article.dimensions}
                          onChange={e => updateArticle(index, 'dimensions', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Photo Upload */}
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Photo (optionnel)
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

              {/* Actions */}
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

            {/* History Section */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Historique des demandes</h3>
              {requests.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucune demande pour le moment
                </p>
              ) : (
                <div className="space-y-3">
                  {requests.map(request => (
                    <div key={request.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">{request.nomDemandeur}</p>
                          <p className="text-sm text-gray-600">
                            {new Date(request.dateDemande).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            Statut : <span className="font-medium">{request.statut}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-indigo-700">
                            {parseFloat(request.totalGeneral || 0).toFixed(2)} MAD
                          </p>
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
        {currentUser.role === 'acheteur' && (
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
                  <div key={request.id} className="bg-white rounded-2xl shadow-lg overflow-hidden">
                    <div className="p-6 space-y-4">
                      {/* Header */}
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg text-gray-900">
                            {request.nomDemandeur}
                          </p>
                          <p className="text-sm text-gray-600">
                            {new Date(request.dateDemande).toLocaleDateString()}
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

                      {/* Details */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Total général</p>
                          <p className="font-bold text-xl text-gray-900">
                            {parseFloat(request.totalGeneral || 0).toFixed(2)} MAD
                          </p>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Date livraison souhaitée</p>
                          <p className="font-medium text-gray-900">
                            {request.dateLivraisonSouhaitee ? 
                              new Date(request.dateLivraisonSouhaitee).toLocaleDateString() : 
                              'Non spécifiée'}
                          </p>
                        </div>
                      </div>

                      {/* Articles */}
                      <div className="border-t pt-4">
                        <p className="font-medium text-gray-900 mb-3">Articles :</p>
                        <div className="space-y-3">
                          {request.articles?.map((article, idx) => (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3">
                              <p className="font-medium text-gray-900">{article.designation}</p>
                              <div className="flex justify-between text-sm text-gray-600 mt-2">
                                <span>Qté: {article.quantite || '1'}</span>
                                <span>Prix: {parseFloat(article.prix || 0).toFixed(2)} MAD</span>
                              </div>
                              {article.dimensions && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Dimensions: {article.dimensions}
                                </p>
                              )}
                              {article.photo_url && (
                                <div className="mt-2">
                                  <img
                                    src={article.photo_url}
                                    alt={article.designation}
                                    className="h-24 w-auto object-cover rounded border"
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-3 pt-4 border-t">
                        <button className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">
                          <CheckCircle className="inline mr-2" size={18} />
                          Valider
                        </button>
                        <button className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200">
                          Voir détails
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
