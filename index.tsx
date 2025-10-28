
import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


// Define the structure for price history and product data
interface PriceHistoryEntry {
  date: string; // ISO string
  price: string | null;
}

interface ProductStore {
  name: "Amazon" | "Mercado Livre";
  currentPrice: string | null;
  url: string | null;
  priceHistory: PriceHistoryEntry[];
}

interface Product {
  productName: string;
  imageUrl: string;
  stores: ProductStore[];
  originalUrl: string;
  affiliateIds?: {
    amazon?: string;
    mercadoLivre?: string;
  };
}

const App = () => {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const savedProducts = localStorage.getItem('priceTrackerProducts');
      const parsedProducts = savedProducts ? JSON.parse(savedProducts) : [];
      // Migration step for old data structure in localStorage
      return parsedProducts.map((p: any) => {
        if (p.stores && p.stores.length > 0 && 'price' in p.stores[0]) {
            return {
                ...p,
                stores: p.stores.map((s: any) => ({
                    name: s.name,
                    url: s.url,
                    currentPrice: s.price,
                    priceHistory: s.priceHistory || [{ date: new Date().toISOString(), price: s.price }]
                }))
            };
        }
        // Ensure priceHistory is always an array
        if (p.stores) {
            p.stores.forEach((s: any) => {
                if (!s.priceHistory) {
                    s.priceHistory = s.currentPrice ? [{ date: new Date().toISOString(), price: s.currentPrice }] : [];
                }
            });
        }
        return p;
      });
    } catch (error) {
      console.error("Could not load products from localStorage", error);
      return [];
    }
  });

  const [productUrl, setProductUrl] = useState('');
  const [globalAffiliateIds, setGlobalAffiliateIds] = useState({
    amazon: 'facoriolano-20',
    mercadoLivre: 'fabriciocoriolano'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [updatingProductIndex, setUpdatingProductIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState('all'); // 'all', 'onSale24h'
  const [sort, setSort] = useState('default'); // 'default', 'priceAsc', 'priceDesc'
  
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [editingState, setEditingState] = useState<{
    product: Product;
    index: number;
    newUrl: string;
    newAffiliateIds: {
        amazon: string;
        mercadoLivre: string;
    };
  } | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem('priceTrackerProducts', JSON.stringify(products));
    } catch (error) {
      console.error("Could not save products to localStorage", error);
    }
  }, [products]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const constructAffiliateUrl = (url: string, storeName: "Amazon" | "Mercado Livre", productAffiliateIds?: { amazon?: string; mercadoLivre?: string; }): string => {
    let idToUse: string | undefined;
    if (storeName === 'Amazon') {
      idToUse = productAffiliateIds?.amazon || globalAffiliateIds.amazon;
    } else if (storeName === 'Mercado Livre') {
      idToUse = productAffiliateIds?.mercadoLivre || globalAffiliateIds.mercadoLivre;
    }
    if (!idToUse || !url || url === 'N/A') return url;
    try {
      const urlObject = new URL(url);
      if (storeName === 'Amazon') urlObject.searchParams.set('tag', idToUse);
      else if (storeName === 'Mercado Livre') urlObject.searchParams.set('afid', idToUse);
      return urlObject.toString();
    } catch (e) {
      console.error("Invalid URL for affiliate processing:", url);
      return url;
    }
  };
  
  const fetchProductData = async (url: string): Promise<Omit<Product, 'affiliateIds' | 'stores'> & { stores: Array<{ name: 'Amazon' | 'Mercado Livre'; price: string | null; url: string | null; }> }> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Analisando a URL de referência '${url}', identifique o produto exato. Em seguida, usando a busca, encontre o nome completo do produto, a URL da imagem principal de alta resolução, e o preço e a URL do produto correspondente na Amazon.com.br e no MercadoLivre.com.br.
Sua resposta DEVE ser APENAS um único bloco de código JSON válido, sem nenhum texto, markdown ou explicação. Siga estritamente este formato.
Se você não conseguir encontrar o produto ou qualquer uma das informações, preencha os campos com 'N/A'.
Em caso de QUALQUER erro, sua resposta AINDA DEVE ser um JSON neste formato: {"error": "Sua descrição do erro aqui"}.

Formato de sucesso:
{
    "productName": "O nome completo do produto",
    "imageUrl": "A URL da imagem principal ou 'N/A'",
    "amazon": { "price": "O preço à vista na Amazon, como 'R$ 1.234,56', ou 'N/A'", "url": "A URL do produto na Amazon ou 'N/A'" },
    "mercadoLivre": { "price": "O preço à vista no Mercado Livre, como 'R$ 1.234,56', ou 'N/A'", "url": "A URL do produto no Mercado Livre ou 'N/A'" }
}`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
    });

    let data;
    try {
        const textResponse = response.text;
        const firstBrace = textResponse.indexOf('{');
        const lastBrace = textResponse.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
            throw new Error("Nenhum objeto JSON encontrado na resposta da IA.");
        }
        const jsonString = textResponse.substring(firstBrace, lastBrace + 1);
        data = JSON.parse(jsonString);
    } catch (e) {
        console.error("Falha ao analisar a resposta JSON:", response.text, e);
        throw new Error("A IA retornou uma resposta em formato inválido. Tente novamente.");
    }

    if (data.error) {
        console.error("A IA retornou um erro estruturado:", data.error);
        throw new Error(`A IA retornou um erro: ${data.error}`);
    }

    if (!data.productName && !data.imageUrl) {
        throw new Error("Não foi possível extrair nenhuma informação da URL fornecida.");
    }

    return {
      productName: data.productName || 'Nome não encontrado',
      imageUrl: data.imageUrl || 'N/A',
      stores: [
        { name: "Amazon", price: data.amazon?.price || 'N/A', url: data.amazon?.url || 'N/A' },
        { name: "Mercado Livre", price: data.mercadoLivre?.price || 'N/A', url: data.mercadoLivre?.url || 'N/A' }
      ],
      originalUrl: url
    };
  };

  const handleAddProduct = async () => {
    if (!productUrl.trim()) {
      setError("Por favor, insira o URL de um produto.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const productData = await fetchProductData(productUrl);
      const now = new Date().toISOString();
      const storesWithHistory = productData.stores.map(store => ({
          name: store.name,
          url: store.url,
          currentPrice: store.price,
          priceHistory: [{ date: now, price: store.price }]
      }));
      const newProduct: Product = { ...productData, stores: storesWithHistory, affiliateIds: globalAffiliateIds };
      setProducts(prevProducts => [...prevProducts, newProduct]);
      setProductUrl('');
    } catch (err) {
      console.error(err);
      setError(`Não foi possível buscar as informações. Detalhe: ${err instanceof Error ? err.message : "Erro desconhecido."}`);
    } finally {
      setIsLoading(false);
    }
  };

  const updateProductData = async (product: Product): Promise<Product> => {
    const newData = await fetchProductData(product.originalUrl);
    const now = new Date().toISOString();
    
    const updatedStores = newData.stores.map(newStoreData => {
        const oldStore = product.stores.find(s => s.name === newStoreData.name);
        const oldPriceHistory = oldStore?.priceHistory || [];
        const lastPriceEntry = oldPriceHistory[oldPriceHistory.length - 1];
        
        let newPriceHistory = [...oldPriceHistory];
        if (lastPriceEntry?.price !== newStoreData.price) {
            newPriceHistory.push({ date: now, price: newStoreData.price });
        }
        
        return {
            name: newStoreData.name,
            url: newStoreData.url,
            currentPrice: newStoreData.price,
            priceHistory: newPriceHistory,
        };
    });
    return { ...newData, stores: updatedStores, affiliateIds: product.affiliateIds };
  };

  const handleUpdateAllProducts = async () => {
    setIsUpdatingAll(true);
    setError(null);
    const updatePromises = products.map(updateProductData);
    const results = await Promise.allSettled(updatePromises);
    const updatedProducts = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.error(`Failed to update product ${products[index].productName}:`, result.reason);
      return products[index];
    });
    setProducts(updatedProducts);
    setIsUpdatingAll(false);
  };

  const handleSaveEdit = async () => {
    if (!editingState) return;
    setIsSavingEdit(true);
    setError(null);
    const { index, newUrl, newAffiliateIds, product } = editingState;
    try {
      let updatedProduct: Product;
      if (newUrl !== product.originalUrl) {
          setUpdatingProductIndex(index);
          setEditingState(null);
          const fetchedData = await fetchProductData(newUrl);
          const now = new Date().toISOString();
          const updatedStores = fetchedData.stores.map(store => ({
              name: store.name,
              url: store.url,
              currentPrice: store.price,
              priceHistory: [{ date: now, price: store.price }]
          }));
          updatedProduct = { ...fetchedData, stores: updatedStores, affiliateIds: newAffiliateIds };
      } else {
        updatedProduct = { ...product, affiliateIds: newAffiliateIds };
        setEditingState(null);
      }
      const newProducts = [...products];
      newProducts[index] = updatedProduct;
      setProducts(newProducts);
    } catch (err) {
      console.error("Failed to save edit:", err);
      setError(`Não foi possível salvar. Detalhe: ${err instanceof Error ? err.message : "Erro desconhecido."}`);
      setEditingState(null);
    } finally {
      setIsSavingEdit(false);
      setUpdatingProductIndex(null);
    }
  };
  
  const handleDeleteProduct = (index: number) => {
    setProducts(prevProducts => prevProducts.filter((_, i) => i !== index));
  };

  const displayedProducts = useMemo(() => {
    const parsePrice = (priceStr: string | null): number => {
        if (!priceStr || priceStr === 'N/A') return Infinity;
        return parseFloat(priceStr.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
    };

    const getBestPrice = (p: Product): number => {
        const prices = p.stores.map(s => parsePrice(s.currentPrice)).filter(price => price !== Infinity);
        return prices.length > 0 ? Math.min(...prices) : Infinity;
    };

    const hasPriceDropped24h = (p: Product): boolean => {
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        return p.stores.some(store => {
            if (store.priceHistory.length < 2) return false;
            const lastEntry = store.priceHistory[store.priceHistory.length - 1];
            if (new Date(lastEntry.date).getTime() < twentyFourHoursAgo) return false;
            const secondLastEntry = store.priceHistory[store.priceHistory.length - 2];
            return parsePrice(lastEntry.price) < parsePrice(secondLastEntry.price);
        });
    };

    let filtered = [...products];
    if (filter === 'onSale24h') {
        filtered = filtered.filter(hasPriceDropped24h);
    }
    switch (sort) {
        case 'priceAsc': filtered.sort((a, b) => getBestPrice(a) - getBestPrice(b)); break;
        case 'priceDesc': filtered.sort((a, b) => getBestPrice(b) - getBestPrice(a)); break;
    }
    return filtered;
  }, [products, filter, sort]);

  const ProductCard: React.FC<{ product: Product, index: number, theme: string }> = ({ product, index, theme }) => {
    const [showHistory, setShowHistory] = useState(false);

    const parsePrice = (priceStr: string | null): number => {
        if (!priceStr || priceStr === 'N/A') return Infinity;
        return parseFloat(priceStr.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
    };

    const bestOffer = useMemo(() => {
        const validStores = product.stores.filter(s => s.currentPrice && s.url && s.currentPrice !== 'N/A' && s.url !== 'N/A');
        if (validStores.length === 0) return null;
        return validStores.reduce((best, current) => parsePrice(current.currentPrice) < parsePrice(best.currentPrice) ? current : best);
    }, [product.stores]);
    
    const chartData = useMemo(() => {
        const parsePriceForChart = (priceStr: string | null): number | null => {
            if (!priceStr || priceStr === 'N/A') return null;
            return parseFloat(priceStr.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
        };

        const amazonStore = product.stores.find(s => s.name === 'Amazon');
        const mlStore = product.stores.find(s => s.name === 'Mercado Livre');
        const allEntries: { date: number; amazonPrice?: number | null; mercadoLivrePrice?: number | null }[] = [];

        amazonStore?.priceHistory.forEach(entry => allEntries.push({ date: new Date(entry.date).getTime(), amazonPrice: parsePriceForChart(entry.price) }));
        mlStore?.priceHistory.forEach(entry => allEntries.push({ date: new Date(entry.date).getTime(), mercadoLivrePrice: parsePriceForChart(entry.price) }));

        if (allEntries.length === 0) return [];

        const groupedByDate = allEntries.reduce((acc, curr) => {
            const dateKey = new Date(curr.date).toISOString().split('T')[0];
            if (!acc[dateKey]) acc[dateKey] = { date: new Date(dateKey).getTime() };
            if (curr.amazonPrice !== undefined) acc[dateKey].amazonPrice = curr.amazonPrice;
            if (curr.mercadoLivrePrice !== undefined) acc[dateKey].mercadoLivrePrice = curr.mercadoLivrePrice;
            return acc;
        }, {} as Record<string, { date: number; amazonPrice?: number | null; mercadoLivrePrice?: number | null }>);

        const sortedData = Object.values(groupedByDate).sort((a, b) => a.date - b.date);

        let lastAmazonPrice: number | null = null;
        let lastMlPrice: number | null = null;
        const filledData = sortedData.map(d => {
            if (d.amazonPrice !== undefined && d.amazonPrice !== null) lastAmazonPrice = d.amazonPrice; else d.amazonPrice = lastAmazonPrice;
            if (d.mercadoLivrePrice !== undefined && d.mercadoLivrePrice !== null) lastMlPrice = d.mercadoLivrePrice; else d.mercadoLivrePrice = lastMlPrice;
            return d;
        });

        return filledData.map(d => ({
            ...d,
            formattedDate: new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        }));
    }, [product.stores]);

    const PriceChangeIndicator: React.FC<{ history: PriceHistoryEntry[] }> = ({ history }) => {
        if (history.length < 2) return null;
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        const lastEntry = history[history.length - 1];
        const secondLastEntry = history[history.length - 2];
        if (new Date(lastEntry.date).getTime() < twentyFourHoursAgo) return null;
        const lastPrice = parsePrice(lastEntry.price);
        const prevPrice = parsePrice(secondLastEntry.price);
        if (lastPrice === Infinity || prevPrice === Infinity || lastPrice === prevPrice) return null;
        const change = lastPrice - prevPrice;
        const isDrop = change < 0;
        return (
            <div className={`flex items-center text-xs font-semibold ${isDrop ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                {isDrop ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                )}
                <span>{Math.abs(change).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
        );
    };

    const placeholderImg = 'https://via.placeholder.com/300x300.png?text=Imagem+Indisponível';
    
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300 flex flex-col group relative border border-gray-200 dark:border-transparent">
          {updatingProductIndex === index && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 flex flex-col justify-center items-center z-20 rounded-lg">
                <svg className="animate-spin h-8 w-8 text-gray-800 dark:text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <p className="mt-2 text-gray-800 dark:text-white font-semibold">Atualizando...</p>
            </div>
          )}
          {isAdminMode && (
              <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button onClick={() => setEditingState({ product, index, newUrl: product.originalUrl, newAffiliateIds: { amazon: product.affiliateIds?.amazon || '', mercadoLivre: product.affiliateIds?.mercadoLivre || '' } })} className="bg-gray-200/60 dark:bg-gray-700/60 hover:bg-cyan-500 text-gray-800 dark:text-white hover:text-white p-2 rounded-full" aria-label="Editar produto" disabled={isLoading || isUpdatingAll || isSavingEdit || updatingProductIndex !== null}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg></button>
                <button onClick={() => handleDeleteProduct(index)} className="bg-gray-200/60 dark:bg-gray-700/60 hover:bg-red-600 text-gray-800 dark:text-white hover:text-white p-2 rounded-full" aria-label="Excluir produto" disabled={isLoading || isUpdatingAll || isSavingEdit || updatingProductIndex !== null}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg></button>
              </div>
          )}
          <div className="bg-white p-2 flex-shrink-0"><img src={!product.imageUrl || product.imageUrl === 'N/A' ? placeholderImg : product.imageUrl} alt={product.productName} className="w-full h-48 object-contain" onError={(e) => { const target = e.target as HTMLImageElement; target.onerror = null; target.src = placeholderImg; }} /></div>
          <div className="p-4 flex flex-col flex-grow">
            <h3 className="font-bold text-lg h-14 overflow-hidden text-gray-800 dark:text-gray-200">{product.productName}</h3>
            <div className="mt-4 space-y-3 flex-grow">
              {product.stores.map((store, storeIndex) => {
                  const hasOffer = store.url && store.url !== 'N/A' && store.currentPrice && store.currentPrice !== 'N/A';
                  if (!hasOffer) return null;

                  return (
                    <div key={storeIndex} className={`p-3 rounded-lg transition-all ${bestOffer?.name === store.name ? 'bg-cyan-100 dark:bg-cyan-900/50 ring-2 ring-cyan-500' : 'bg-gray-100 dark:bg-gray-700/80'}`}>
                      <div className="flex justify-between items-center">
                        <img src={store.name === 'Amazon' ? 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg' : 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Mercado_Livre_logo.svg/2560px-Mercado_Livre_logo.svg.png'} alt={store.name} className="h-5" />
                        <div className="text-right">
                          <p className="font-bold text-xl text-gray-900 dark:text-white">{store.currentPrice}</p>
                          <PriceChangeIndicator history={store.priceHistory} />
                        </div>
                      </div>
                      <a href={constructAffiliateUrl(store.url!, store.name, product.affiliateIds)} target="_blank" rel="noopener noreferrer" className="block w-full text-center bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-md transition-colors mt-3 text-sm">
                        Comprar
                      </a>
                    </div>
                  );
              })}
              {!product.stores.some(s => s.url && s.url !== 'N/A' && s.currentPrice && s.currentPrice !== 'N/A') && (
                  <div className="text-center text-gray-500 dark:text-gray-400 p-4 bg-gray-100 dark:bg-gray-700/50 rounded-lg">
                      Nenhuma oferta encontrada.
                  </div>
              )}
            </div>
            <div className="mt-auto pt-4">
              {chartData.length > 1 && (
                <button onClick={() => setShowHistory(!showHistory)} className="block w-full text-center bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-semibold py-2 px-4 rounded-md transition-colors text-sm">
                  {showHistory ? 'Esconder' : 'Ver'} Histórico de Preços
                </button>
              )}
            </div>
          </div>
          {showHistory && chartData.length > 1 && (
            <div className="bg-gray-100 dark:bg-gray-700/50 p-4 border-t border-gray-200 dark:border-gray-700">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? "#556278" : "#e5e7eb"} />
                  <XAxis dataKey="formattedDate" stroke={theme === 'dark' ? "#a0aec0" : "#4b5563"} fontSize={12} />
                  <YAxis stroke={theme === 'dark' ? "#a0aec0" : "#4b5563"} fontSize={12} tickFormatter={(value) => `R$${value}`} domain={[(dataMin: number) => (dataMin > 20 ? dataMin - 20 : 0), (dataMax: number) => dataMax + 20]} />
                  <Tooltip
                    contentStyle={{ 
                        backgroundColor: theme === 'dark' ? '#1a202c' : '#ffffff', 
                        border: `1px solid ${theme === 'dark' ? '#4a5568' : '#e5e7eb'}`, 
                        borderRadius: '0.5rem' 
                    }}
                    labelStyle={{ color: theme === 'dark' ? '#e2e8f0' : '#111827', marginBottom: '4px' }}
                    itemStyle={{ color: theme === 'dark' ? '#cbd5e0' : '#374151' }}
                    formatter={(value: number, name: string) => [value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), name === 'amazonPrice' ? 'Amazon' : 'Mercado Livre']}
                    labelFormatter={(label) => `Data: ${label}`}
                  />
                  <Legend wrapperStyle={{fontSize: "12px"}} />
                  <Line type="monotone" dataKey="amazonPrice" name="Amazon" stroke="#FF9900" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="mercadoLivrePrice" name="Mercado Livre" stroke="#FFE600" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
    );
  };
  
  const ThemeToggle = () => (
    <button
      onClick={() => setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light')}
      className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 focus:ring-cyan-500"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
      )}
    </button>
  );

  return (
    <>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white font-sans p-4 sm:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="text-center mb-8 relative">
            <h1 className="text-4xl sm:text-5xl font-bold text-cyan-600 dark:text-cyan-400">Price Tracker Pro</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">Sua vitrine de produtos selecionados com os melhores preços.</p>
            <div className="absolute top-0 right-0 flex items-center gap-4">
                <ThemeToggle />
                <div className="hidden sm:block">
                  <label htmlFor="admin-toggle" className="flex items-center cursor-pointer">
                    <span className="mr-3 text-sm font-medium text-gray-600 dark:text-gray-300">Modo Loja</span>
                    <div className="relative">
                        <input type="checkbox" id="admin-toggle" className="sr-only peer" checked={isAdminMode} onChange={() => setIsAdminMode(!isAdminMode)} />
                        <div className="block bg-gray-300 dark:bg-gray-600 w-14 h-8 rounded-full"></div>
                        <div className="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform peer-checked:translate-x-full peer-checked:bg-cyan-600"></div>
                    </div>
                    <span className="ml-3 text-sm font-medium text-cyan-600 dark:text-cyan-400">Modo Admin</span>
                  </label>
                </div>
            </div>
          </header>

          <main>
            {isAdminMode && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg mb-8 sticky top-4 z-30">
                <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">Adicionar Novo Produto</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input type="text" value={globalAffiliateIds.amazon} onChange={(e) => setGlobalAffiliateIds(prev => ({...prev, amazon: e.target.value}))} placeholder="Seu ID de Afiliado Amazon (tag)" className="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500" aria-label="Seu ID de Afiliado Amazon (Global)" />
                    <input type="text" value={globalAffiliateIds.mercadoLivre} onChange={(e) => setGlobalAffiliateIds(prev => ({...prev, mercadoLivre: e.target.value}))} placeholder="Seu ID de Afiliado Mercado Livre (afid)" className="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500" aria-label="Seu ID de Afiliado Mercado Livre (Global)" />
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                    <input type="url" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="Cole o link do produto aqui (Ex: Amazon)" className="flex-grow bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500" disabled={isLoading || isUpdatingAll || updatingProductIndex !== null} aria-label="URL do Produto" />
                    <button onClick={handleAddProduct} disabled={isLoading || isUpdatingAll || updatingProductIndex !== null || !productUrl} className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-md transition-colors duration-300 flex items-center justify-center">
                    {isLoading ? (<svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>) : 'Adicionar'}
                    </button>
                </div>
                {error && !editingState && <p className="text-red-500 dark:text-red-400 mt-4 text-center">{error}</p>}
                </div>
            )}
            
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
              <h2 className="text-3xl font-bold text-gray-700 dark:text-gray-300">Meus Produtos</h2>
              {isAdminMode && (<button onClick={handleUpdateAllProducts} disabled={isLoading || isUpdatingAll || updatingProductIndex !== null || products.length === 0} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors duration-300 flex items-center justify-center gap-2" aria-label="Atualizar preços de todos os produtos">
                {isUpdatingAll ? (<><svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Atualizando...</span></>) : (<><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg><span>Atualizar Todos</span></>)}
              </button>)}
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg mb-6 flex flex-col sm:flex-row justify-center items-center gap-6">
                <div className="flex items-center gap-2"><label htmlFor="filter-select" className="text-gray-600 dark:text-gray-300 font-medium text-sm">Filtrar:</label><select id="filter-select" value={filter} onChange={e => setFilter(e.target.value)} className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"><option value="all">Todos os produtos</option><option value="onSale24h">Em promoção (24h)</option></select></div>
                <div className="flex items-center gap-2"><label htmlFor="sort-select" className="text-gray-600 dark:text-gray-300 font-medium text-sm">Ordenar:</label><select id="sort-select" value={sort} onChange={e => setSort(e.target.value)} className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"><option value="default">Padrão</option><option value="priceAsc">Menor Preço</option><option value="priceDesc">Maior Preço</option></select></div>
            </div>

            {displayedProducts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {displayedProducts.map((product, index) => (<ProductCard key={`${product.originalUrl}-${index}`} product={product} index={products.findIndex(p => p.originalUrl === product.originalUrl)} theme={theme} />))}
                </div>
            ) : (
                <div className="text-center py-16 px-6 bg-white dark:bg-gray-800 rounded-lg">
                    <h3 className="text-2xl font-bold text-gray-700 dark:text-gray-300">Nenhum produto encontrado</h3>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        {filter === 'onSale24h' ? 'Nenhum produto entrou em promoção nas últimas 24 horas.' : 'Adicione um produto usando o painel de Admin para começar.'}
                    </p>
                </div>
            )}
          </main>
        </div>
      </div>
      
      {editingState && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" aria-modal="true" role="dialog">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-4">Editar Produto</h2>
            <div className="space-y-4">
              <div><label htmlFor="edit-url" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">URL do Produto</label><input type="url" id="edit-url" value={editingState.newUrl} onChange={(e) => setEditingState({ ...editingState, newUrl: e.target.value })} className="w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500" /></div>
              <div><label htmlFor="edit-affiliate-id-amazon" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">ID de Afiliado Amazon</label><input type="text" id="edit-affiliate-id-amazon" value={editingState.newAffiliateIds.amazon} onChange={(e) => setEditingState(prev => prev ? { ...prev, newAffiliateIds: {...prev.newAffiliateIds, amazon: e.target.value } } : null)} placeholder="Deixe em branco para usar o ID global" className="w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500" /></div>
              <div><label htmlFor="edit-affiliate-id-ml" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">ID de Afiliado Mercado Livre</label><input type="text" id="edit-affiliate-id-ml" value={editingState.newAffiliateIds.mercadoLivre} onChange={(e) => setEditingState(prev => prev ? { ...prev, newAffiliateIds: {...prev.newAffiliateIds, mercadoLivre: e.target.value } } : null)} placeholder="Deixe em branco para usar o ID global" className="w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500" /></div>
            </div>
            {error && editingState && <p className="text-red-500 dark:text-red-400 mt-4 text-center">{error}</p>}
            <div className="mt-6 flex justify-end gap-4">
              <button onClick={() => { setEditingState(null); setError(null); }} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition-colors" disabled={isSavingEdit}>Cancelar</button>
              <button onClick={handleSaveEdit} className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors flex items-center justify-center min-w-[110px]" disabled={isSavingEdit}>
                {isSavingEdit ? (<><svg className="animate-spin h-5 w-5 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Salvando...</span></>) : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);