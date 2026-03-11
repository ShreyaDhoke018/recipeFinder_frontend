import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const api = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('chefai_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

export interface IngredientInput { name: string; quantity: string; unit: string; }
export interface Recipe {
  _id?: string;
  title: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  imageUrl?: string;
  imageBase64?: string;
  sourceUrl?: string;
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  tags?: string[];
  likes?: number;
  savedByUserIds?: string[];
  isSaved?: boolean;
  isUserCreated?: boolean;
  isVegetarian?: boolean;
  source?: string;
  cuisine?: string;
  difficulty?: string;
  calories?: string;
  createdByUserId?: string;
  createdByName?: string;
}
export interface SearchResult { recipes: Recipe[]; query: string; totalFound: number; page: number; totalPages: number; }
export interface AuthUser { id: string; name: string; email: string; }

export const register = async (name: string, email: string, password: string) => { const r = await api.post('/auth/register', { name, email, password }); return r.data; };
export const login = async (email: string, password: string) => { const r = await api.post('/auth/login', { email, password }); return r.data; };

export const searchRecipes = async (ingredients: IngredientInput[], page = 1): Promise<SearchResult> => { const r = await api.post(`/recipes/search?page=${page}`, { ingredients }); return r.data; };
export const getSavedRecipes = async (): Promise<Recipe[]> => { const r = await api.get('/recipes/saved'); return r.data; };
export const saveRecipe = async (recipe: Recipe): Promise<Recipe> => { const r = await api.post('/recipes/save', recipe); return r.data; };
export const unsaveRecipe = async (id: string) => { await api.delete(`/recipes/saved/${id}`); };
export const deleteSavedRecipe = async (id: string) => { await api.delete(`/recipes/saved/${id}`); };

// My Recipes CRUD
export const getMyRecipes = async (): Promise<Recipe[]> => { const r = await api.get('/recipes/my'); return r.data; };
export const createMyRecipe = async (recipe: Partial<Recipe>): Promise<Recipe> => { const r = await api.post('/recipes/my', recipe); return r.data; };
export const updateMyRecipe = async (id: string, recipe: Partial<Recipe>): Promise<Recipe> => { const r = await api.put(`/recipes/my/${id}`, recipe); return r.data; };
export const deleteMyRecipe = async (id: string) => { await api.delete(`/recipes/my/${id}`); };

export const getIngredients = async () => { const r = await api.get('/ingredients'); return r.data; };
export default api;
