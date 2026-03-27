import React, { useState, useEffect, useRef } from 'react';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  orderBy
} from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Image as ImageIcon, 
  User, 
  LogOut, 
  Coins, 
  Calendar, 
  Sparkles, 
  History, 
  Loader2, 
  ChevronRight,
  Upload,
  X,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { auth, db, googleProvider } from './firebase';
import { cn } from './lib/utils';
import { 
  UserProfile, 
  Comic, 
  STYLES, 
  DAILY_CREDITS, 
  COMIC_COST 
} from './types';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- App Component ---
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [comics, setComics] = useState<Comic[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Generation State
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0].id);
  const [details, setDetails] = useState('');
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [characterImage2, setCharacterImage2] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // --- Auth & Profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchProfile(firebaseUser.uid);
        const unsubscribeComics = subscribeToComics(firebaseUser.uid);
        return () => unsubscribeComics();
      } else {
        setProfile(null);
        setComics([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const fetchProfile = async (uid: string) => {
    const path = `users/${uid}`;
    try {
      const docRef = doc(db, path);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          uid,
          email: auth.currentUser?.email || '',
          displayName: auth.currentUser?.displayName || '',
          photoURL: auth.currentUser?.photoURL || '',
          credits: 50, // Starting credits
          checkInStreak: 0,
        };
        await setDoc(docRef, newProfile);
        setProfile(newProfile);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  };

  const subscribeToComics = (uid: string) => {
    const path = 'comics';
    const q = query(
      collection(db, path), 
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    
    return onSnapshot(q, (snapshot) => {
      const loadedComics = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Comic[];
      setComics(loadedComics);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    });
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to sign in with Google.');
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Daily Check-in ---
  const handleCheckIn = async () => {
    if (!profile || !user) return;

    const now = new Date();
    const lastCheckIn = profile.lastCheckIn ? new Date(profile.lastCheckIn) : null;
    
    // Check if already checked in today
    if (lastCheckIn && lastCheckIn.toDateString() === now.toDateString()) {
      setError('Already checked in today!');
      return;
    }

    let newStreak = 1;
    if (lastCheckIn) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastCheckIn.toDateString() === yesterday.toDateString()) {
        newStreak = (profile.checkInStreak || 0) + 1;
      }
    }

    // Reset streak after 5 days
    if (newStreak > 5) newStreak = 1;

    const reward = DAILY_CREDITS[newStreak - 1];
    const path = `users/${user.uid}`;
    
    try {
      await updateDoc(doc(db, path), {
        credits: profile.credits + reward,
        lastCheckIn: now.toISOString(),
        checkInStreak: newStreak
      });
      setProfile(prev => prev ? {
        ...prev,
        credits: prev.credits + reward,
        lastCheckIn: now.toISOString(),
        checkInStreak: newStreak
      } : null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  // --- Image Handling ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, slot: 1 | 2) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (slot === 1) setCharacterImage(reader.result as string);
        else setCharacterImage2(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Generation ---
  const generateComic = async () => {
    if (!profile || !user) return;
    if (profile.credits < COMIC_COST) {
      setError('Not enough credits!');
      return;
    }
    if (!details.trim()) {
      setError('Please add some details for your comic.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const style = STYLES.find(s => s.id === selectedStyle);
      
      const prompt = `Create a comic panel in the style of ${style?.name}. 
      Style description: ${style?.description}.
      Comic details: ${details}.
      ${characterImage ? 'Use the first provided character image as a reference for the main character.' : ''}
      ${characterImage2 ? 'Use the second provided character image as a reference for another character or detail.' : ''}`;

      const contents: any[] = [{ text: prompt }];
      if (characterImage) {
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: characterImage.split(',')[1],
          },
        });
      }
      if (characterImage2) {
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: characterImage2.split(',')[1],
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts: contents },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      let imageUrl = '';
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!imageUrl) throw new Error('Failed to generate image');

      // Save to Firestore
      const comicPath = 'comics';
      await addDoc(collection(db, comicPath), {
        uid: user.uid,
        imageUrl,
        prompt: details,
        style: style?.name,
        createdAt: new Date().toISOString()
      });

      // Deduct credits
      const userPath = `users/${user.uid}`;
      await updateDoc(doc(db, userPath), {
        credits: profile.credits - COMIC_COST
      });

      setProfile(prev => prev ? { ...prev, credits: prev.credits - COMIC_COST } : null);
      setDetails('');
      setCharacterImage(null);
      setCharacterImage2(null);
    } catch (err) {
      console.error('Generation error:', err);
      setError('Failed to generate comic. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_30%,#3a1510_0%,transparent_60%)]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-4">
            <div className="w-20 h-20 bg-orange-500 rounded-3xl mx-auto flex items-center justify-center shadow-[0_0_40px_rgba(249,115,22,0.3)]">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-5xl font-bold tracking-tighter">Comic Maker</h1>
            <p className="text-zinc-400 text-lg">Turn your ideas into stunning anime-style comic panels with AI.</p>
          </div>

          <button
            onClick={handleLogin}
            className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-200 transition-colors group"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>

          <div className="grid grid-cols-3 gap-4 pt-8 border-t border-zinc-800">
            <div className="text-center">
              <div className="text-2xl font-bold">100%</div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest">AI Powered</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">3+</div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Art Styles</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">Free</div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Daily Credits</div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0A0A0A]/80 backdrop-blur-xl border-b border-zinc-800/50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">Comic Maker</span>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800">
              <Coins className="w-4 h-4 text-orange-500" />
              <span className="font-bold">{profile?.credits || 0}</span>
              <span className="text-zinc-500 text-sm">Credits</span>
            </div>
            
            <div className="flex items-center gap-3">
              <img 
                src={user.photoURL || ''} 
                className="w-10 h-10 rounded-full border-2 border-zinc-800" 
                alt={user.displayName || ''} 
              />
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-zinc-900 rounded-full text-zinc-400 hover:text-white transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
        {/* Left Column: Creator & Feed */}
        <div className="space-y-8">
          {/* Creator Section */}
          <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-8 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Create Panel</h2>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Coins className="w-4 h-4" />
                Costs {COMIC_COST} credits
              </div>
            </div>

            <div className="space-y-6">
              {/* Style Selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Select Style</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      className={cn(
                        "p-4 rounded-2xl text-left border transition-all relative overflow-hidden group",
                        selectedStyle === style.id 
                          ? "bg-orange-500/10 border-orange-500 text-white" 
                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <div className="font-bold mb-1">{style.name}</div>
                      <div className="text-xs opacity-60 leading-relaxed">{style.description}</div>
                      {selectedStyle === style.id && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="w-4 h-4 text-orange-500" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Character Upload */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Character References (Optional)</label>
                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-32 h-32 rounded-2xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center gap-2 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
                  >
                    {characterImage ? (
                      <div className="relative w-full h-full p-2">
                        <img src={characterImage} className="w-full h-full object-cover rounded-xl" alt="Preview" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); setCharacterImage(null); }}
                          className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 shadow-lg"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-zinc-500 group-hover:text-orange-500 transition-colors" />
                        <span className="text-xs text-zinc-500">Slot 1</span>
                      </>
                    )}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={(e) => handleImageUpload(e, 1)} 
                    className="hidden" 
                    accept="image/*" 
                  />

                  <button
                    onClick={() => fileInputRef2.current?.click()}
                    className="w-32 h-32 rounded-2xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center gap-2 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
                  >
                    {characterImage2 ? (
                      <div className="relative w-full h-full p-2">
                        <img src={characterImage2} className="w-full h-full object-cover rounded-xl" alt="Preview" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); setCharacterImage2(null); }}
                          className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 shadow-lg"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-zinc-500 group-hover:text-orange-500 transition-colors" />
                        <span className="text-xs text-zinc-500">Slot 2</span>
                      </>
                    )}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef2} 
                    onChange={(e) => handleImageUpload(e, 2)} 
                    className="hidden" 
                    accept="image/*" 
                  />

                  <div className="flex-1 min-w-[200px] flex flex-col justify-center">
                    <p className="text-sm text-zinc-400">Upload character images to use as references. This helps maintain consistency across panels.</p>
                  </div>
                </div>
              </div>

              {/* Details Text */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Comic Details</label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Describe the scene, action, and dialogue... e.g., A young hero standing on a cliff overlooking a futuristic city at sunset, looking determined."
                  className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all resize-none"
                />
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-400 text-sm"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {error}
                </motion.div>
              )}

              <button
                onClick={generateComic}
                disabled={generating}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-[0_10px_30px_rgba(249,115,22,0.2)]"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating Magic...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Create Comic Panel
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Feed Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <History className="w-6 h-6 text-orange-500" />
                Your Collection
              </h2>
            </div>

            {comics.length === 0 ? (
              <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-3xl p-12 text-center space-y-4">
                <ImageIcon className="w-12 h-12 text-zinc-700 mx-auto" />
                <div className="space-y-1">
                  <p className="text-zinc-400 font-medium">No comics yet</p>
                  <p className="text-zinc-600 text-sm">Start creating your first anime masterpiece above!</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AnimatePresence mode="popLayout">
                  {comics.map((comic) => (
                    <motion.div
                      key={comic.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden group"
                    >
                      <div className="aspect-square relative overflow-hidden">
                        <img 
                          src={comic.imageUrl} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                          alt={comic.prompt} 
                        />
                        <div className="absolute top-4 left-4">
                          <span className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10">
                            {comic.style}
                          </span>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <p className="text-sm text-zinc-300 line-clamp-2">{comic.prompt}</p>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
                          {new Date(comic.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Sidebar */}
        <aside className="space-y-8">
          {/* Daily Check-in Card */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Calendar className="w-5 h-5 text-orange-500" />
                Daily Rewards
              </h3>
              <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                Streak: {profile?.checkInStreak || 0}
              </div>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {DAILY_CREDITS.map((reward, i) => {
                const isCompleted = (profile?.checkInStreak || 0) > i;
                const isCurrent = (profile?.checkInStreak || 0) === i;
                
                return (
                  <div 
                    key={i}
                    className={cn(
                      "flex flex-col items-center gap-2 p-2 rounded-xl border transition-all",
                      isCompleted ? "bg-orange-500/10 border-orange-500/50 text-orange-500" : 
                      isCurrent ? "bg-zinc-800 border-zinc-700 text-white" :
                      "bg-zinc-900 border-zinc-800 text-zinc-600"
                    )}
                  >
                    <span className="text-[10px] font-bold">D{i+1}</span>
                    <Coins className="w-4 h-4" />
                    <span className="text-[10px] font-bold">{reward}</span>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleCheckIn}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-2xl transition-colors"
            >
              Claim Daily Credits
            </button>
          </section>

          {/* Quick Stats */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
            <h3 className="font-bold">Account Stats</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 text-sm">Total Comics</span>
                <span className="font-bold">{comics.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 text-sm">Credits Spent</span>
                <span className="font-bold">{comics.length * COMIC_COST}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 text-sm">Member Since</span>
                <span className="font-bold">Mar 2026</span>
              </div>
            </div>
          </section>

          {/* Tips */}
          <section className="bg-orange-500/5 border border-orange-500/20 rounded-3xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-orange-500">
              <Sparkles className="w-4 h-4" />
              <span className="font-bold text-sm">Pro Tip</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Use descriptive adjectives like "cinematic lighting", "dramatic shadows", or "detailed textures" to get better results from the AI.
            </p>
          </section>
        </aside>
      </main>

      {/* Mobile Credits Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0A0A0A]/80 backdrop-blur-xl border-t border-zinc-800 p-4 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-orange-500" />
          <span className="font-bold">{profile?.credits || 0} Credits</span>
        </div>
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="bg-orange-500 text-white px-4 py-2 rounded-full text-sm font-bold"
        >
          Create New
        </button>
      </div>
    </div>
  );
}
