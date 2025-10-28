import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Define the structure for product data
interface ProductStore {
  name: "Amazon" | "Mercado Livre";
  price: string | null;
  url: string | null;
}

interface Product {
  productName: string;
  imageUrl: string;
  stores: ProductStore[];
  originalUrl: string;
  affiliateIds?: { // Each product can have its own affiliate IDs
    amazon?: string;
    mercadoLivre?: string;
  };
}

const App = () => {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const savedProducts = localStorage.getItem('priceTrackerProducts');
      return savedProducts ? JSON.parse(savedProducts) : [];
    } catch (error) {
      console.error("Could not load products from localStorage", error);
      return [];
    }
  });
  const [productUrl, setProductUrl] = useState('');
  // Global affiliate IDs for each store
  const [globalAffiliateIds, setGlobalAffiliateIds] = useState({
    amazon: 'facoriolano-20',
    mercadoLivre: 'fabriciocoriolano'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [updatingProductIndex, setUpdatingProductIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // State for the editing modal
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

  // State for Admin Mode
  const [isAdminMode, setIsAdminMode] = useState(true);

  // Save products to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('priceTrackerProducts', JSON.stringify(products));
    } catch (error) {
      console.error("Could not save products to localStorage", error);
    }
  }, [products]);

  /**
   * Constructs an affiliate URL by appending the correct affiliate ID for the store.
   * Prefers product-specific ID, falls back to global ID.
   * @param url The original product URL.
   * @param storeName The name of the store ("Amazon" or "Mercado Livre").
   * @param productAffiliateIds The product-specific affiliate IDs object.
   * @returns The modified URL with the affiliate tag.
   */
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
      if (storeName === 'Amazon') {
        urlObject.searchParams.set('tag', idToUse);
      } else if (storeName === 'Mercado Livre') {
        // Mercado Livre often uses 'afid'
        urlObject.searchParams.set('afid', idToUse);
      }
      return urlObject.toString();
    } catch (e) {
      console.error("Invalid URL for affiliate processing:", url);
      return url;
    }
  };

  /**
   * Fetches product data from a given URL using the Gemini API.
   * @param url The product URL to search for.
   * @returns A promise that resolves to the product data.
   */
  const fetchProductData = async (url: string): Promise<Omit<Product, 'affiliateIds'>> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `Você é um especialista em análise de e-commerce. Sua missão é extrair dados PRECISOS de um produto, usando a busca para encontrar o mesmo item na Amazon Brasil e no Mercado Livre Brasil.

URL de Referência: ${url}

**REGRAS CRÍTICAS (Siga com precisão máxima):**

1.  **Análise Visual Simulada**: Visualize a página do produto como um usuário faria. Concentre-se nos elementos visuais principais: o título grande, a imagem principal de alta qualidade e o preço em destaque.
2.  **Nome do Produto**: Extraia o nome completo e exato do produto, como exibido no topo da página.
3.  **Imagem Principal**: Encontre a URL da imagem de **ALTA RESOLUÇÃO** na galeria principal. A URL DEVE ser pública e funcional. **NÃO** use miniaturas (thumbnails). Se a imagem não for clara ou não carregar, retorne 'N/A'.
4.  **Preço à Vista**: Sua prioridade é o preço **À VISTA**. IGNORE preços parcelados, preços com juros, ou preços exclusivos para assinantes (como Amazon Prime). Busque o preço principal, mais proeminente, exibido para um comprador comum. Formate como 'R$ 1.234,56'. Se o produto estiver indisponível ou sem preço claro, retorne 'N/A'.
5.  **URL da Loja**: Forneça o link direto para a página exata do produto encontrado. Se não encontrar uma correspondência exata, retorne 'N/A'.

Sua resposta DEVE ser APENAS o texto abaixo, preenchendo os campos. NÃO inclua explicações, comentários ou qualquer outro caractere.

productName: [O nome completo do produto]
imageUrl: [URL da imagem de alta resolução]
amazonPrice: [Preço à vista na Amazon ou 'N/A']
amazonUrl: [URL da Amazon ou 'N/A']
mercadoLivrePrice: [Preço à vista no Mercado Livre ou 'N/A']
mercadoLivreUrl: [URL do Mercado Livre ou 'N/A']`;


    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: prompt,
      config: {
        tools: [{googleSearch: {}}],
      },
    });

    const textResponse = response.text;
    const lines = textResponse.split('\n').filter(line => line.includes(':'));
    
    const parsedData: { [key: string]: string } = {};
    lines.forEach(line => {
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex > -1) {
        const key = line.substring(0, firstColonIndex).trim();
        // Remove brackets that the model might add, e.g., [Some value] -> Some value
        const value = line.substring(firstColonIndex + 1).trim().replace(/^\[|\]$/g, '');
        parsedData[key] = value;
      }
    });

    if (!parsedData.productName || parsedData.productName.toLowerCase() === 'n/a' ) {
        throw new Error("Não foi possível analisar os dados do produto. O modelo não conseguiu identificar o nome.");
    }

    const productData = {
      productName: parsedData.productName || 'Nome não encontrado',
      imageUrl: parsedData.imageUrl || 'N/A',
      stores: [
        {
          name: "Amazon" as const,
          price: parsedData.amazonPrice || 'N/A',
          url: parsedData.amazonUrl || 'N/A',
        },
        {
          name: "Mercado Livre" as const,
          price: parsedData.mercadoLivrePrice || 'N/A',
          url: parsedData.mercadoLivreUrl || 'N/A',
        },
      ],
    };
    
    return { ...productData, originalUrl: url };
  };

  /**
   * Handles adding a new product to the list.
   */
  const handleAddProduct = async () => {
    if (!productUrl.trim()) {
      setError("Por favor, insira o URL de um produto.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const productData = await fetchProductData(productUrl);
      const newProduct: Product = { ...productData, affiliateIds: globalAffiliateIds };
      setProducts(prevProducts => [...prevProducts, newProduct]);
      setProductUrl('');
    } catch (err) {
      console.error(err);
      setError("Não foi possível buscar as informações do produto. Verifique a URL e tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles updating all existing products in the list.
   */
  const handleUpdateAllProducts = async () => {
    setIsUpdatingAll(true);
    setError(null);
    
    // Create promises to fetch new data, but preserve existing affiliate IDs
    const updatePromises = products.map(async (product) => {
        const newData = await fetchProductData(product.originalUrl);
        return { ...newData, affiliateIds: product.affiliateIds }; // Keep old affiliate IDs
    });

    const results = await Promise.allSettled(updatePromises);
    
    const updatedProducts = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`Failed to update product ${products[index].productName}:`, result.reason);
        return products[index]; // On failure, keep the old product data
      }
    });

    setProducts(updatedProducts);
    setIsUpdatingAll(false);
  };

  /**
   * Saves the changes from the edit modal.
   */
  const handleSaveEdit = async () => {
    if (!editingState) return;

    setIsSavingEdit(true);
    setError(null);
    
    const { index, newUrl, newAffiliateIds, product } = editingState;

    try {
      let updatedProduct: Product;
      
      // Refetch product data only if the URL has changed
      if (newUrl !== product.originalUrl) {
          setUpdatingProductIndex(index); // Set loading state for the specific card
          setEditingState(null); // Close modal immediately to show card loader
          
          const fetchedData = await fetchProductData(newUrl);
          updatedProduct = {
            ...fetchedData,
            affiliateIds: newAffiliateIds,
          };
      } else {
        // If only the affiliate IDs changed, just update that locally
        updatedProduct = {
          ...product,
          affiliateIds: newAffiliateIds,
        };
        setEditingState(null); // Close modal
      }
      
      const newProducts = [...products];
      newProducts[index] = updatedProduct;
      setProducts(newProducts);

    } catch (err) {
      console.error("Failed to save edit:", err);
      setError("Não foi possível salvar as alterações. Verifique a URL e tente novamente.");
    } finally {
      setIsSavingEdit(false);
      setUpdatingProductIndex(null); // Clear the specific card's loading state
    }
  };
  
  /**
   * Deletes a product from the list.
   * @param index The index of the product to delete.
   */
  const handleDeleteProduct = (index: number) => {
      setProducts(prevProducts => prevProducts.filter((_, i) => i !== index));
  };

  // FIX: Explicitly type ProductCard as a React.FC to allow the 'key' prop, which is a standard React attribute for list items.
  const ProductCard: React.FC<{ product: Product, index: number }> = ({ product, index }) => {
    const bestOffer = useMemo(() => {
        const parsePrice = (price: string | null): number => {
            if (!price || price === 'N/A') return Infinity;
            return parseFloat(price.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
        };

        const validStores = product.stores.filter(store => store.price && store.url && store.price !== 'N/A' && store.url !== 'N/A');

        if (validStores.length === 0) return null;

        return validStores.reduce((best, current) => {
            const bestPrice = parsePrice(best.price);
            const currentPrice = parsePrice(current.price);
            return currentPrice < bestPrice ? current : best;
        });
    }, [product.stores]);
    
    const placeholderImg = 'https://via.placeholder.com/300x300.png?text=Imagem+Indisponível';

    return (
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-transform transform hover:scale-105 duration-300 flex flex-col group relative">
          {updatingProductIndex === index && (
            <div className="absolute inset-0 bg-gray-800 bg-opacity-80 flex flex-col justify-center items-center z-20 rounded-lg">
                <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="mt-2 text-white font-semibold">Atualizando...</p>
            </div>
          )}
          {isAdminMode && (
              <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button
                  onClick={() => setEditingState({
                    product,
                    index,
                    newUrl: product.originalUrl,
                    newAffiliateIds: {
                      amazon: product.affiliateIds?.amazon || '',
                      mercadoLivre: product.affiliateIds?.mercadoLivre || ''
                    },
                  })}
                  className="bg-gray-700/60 hover:bg-cyan-600/90 text-white p-2 rounded-full"
                  aria-label="Editar produto"
                  disabled={isLoading || isUpdatingAll || isSavingEdit || updatingProductIndex !== null}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                    <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                    onClick={() => handleDeleteProduct(index)}
                    className="bg-gray-700/60 hover:bg-red-600/90 text-white p-2 rounded-full"
                    aria-label="Excluir produto"
                    disabled={isLoading || isUpdatingAll || isSavingEdit || updatingProductIndex !== null}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                    </svg>
                </button>
              </div>
          )}
          <div className="bg-white p-2 flex-shrink-0">
              <img 
                src={!product.imageUrl || product.imageUrl === 'N/A' ? placeholderImg : product.imageUrl} 
                alt={product.productName} 
                className="w-full h-48 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null; // prevent looping
                  target.src = placeholderImg;
                }}
              />
          </div>
          <div className="p-4 flex flex-col flex-grow">
            <h3 className="font-bold text-lg h-14 overflow-hidden text-gray-200 flex-grow">{product.productName}</h3>
            {bestOffer ? (
                <div className="mt-4 space-y-3">
                    <div className="text-center">
                        <p className="text-sm text-gray-400">Melhor preço em:</p>
                        <img 
                          src={bestOffer.name === 'Amazon' ? 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg' : 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Mercado_Livre_logo.svg/2560px-Mercado_Livre_logo.svg.png'} 
                          alt={bestOffer.name} 
                          className="h-6 mx-auto mt-1 mb-2"
                        />
                        <p className="font-bold text-cyan-400 text-3xl">{bestOffer.price}</p>
                    </div>
                    <a
                        href={constructAffiliateUrl(bestOffer.url!, bestOffer.name, product.affiliateIds)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-md transition-colors mt-4"
                      >
                        Ver a Melhor Oferta
                    </a>
                </div>
            ) : (
                <div className="mt-auto pt-4 text-center">
                    <p className="text-gray-400">Oferta indisponível</p>
                    <div className="block w-full text-center bg-gray-600 text-white font-bold py-3 px-4 rounded-md mt-4 cursor-not-allowed">
                        Indisponível
                    </div>
                </div>
            )}
          </div>
        </div>
    );
  };

  return (
    <>
      <div className="min-h-screen bg-gray-900 text-white font-sans p-4 sm:p-8">
        <div className="max-w-6xl mx-auto">
          <header className="text-center mb-8 relative">
            <h1 className="text-4xl sm:text-5xl font-bold text-cyan-400">Price Tracker Pro</h1>
            <p className="text-gray-400 mt-2">Sua vitrine de produtos selecionados com os melhores preços.</p>
            <div className="absolute top-0 right-0">
                <label htmlFor="admin-toggle" className="flex items-center cursor-pointer">
                    <span className="mr-3 text-sm font-medium text-gray-300">Modo Loja</span>
                    <div className="relative">
                        <input type="checkbox" id="admin-toggle" className="sr-only" checked={isAdminMode} onChange={() => setIsAdminMode(!isAdminMode)} />
                        <div className="block bg-gray-600 w-14 h-8 rounded-full"></div>
                        <div className="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform"></div>
                    </div>
                    <span className="ml-3 text-sm font-medium text-cyan-400">Modo Admin</span>
                </label>
            </div>
            <style>{`
                input:checked ~ .dot {
                    transform: translateX(100%);
                    background-color: #0891b2; /* cyan-600 */
                }
            `}</style>
          </header>

          <main>
            {isAdminMode && (
                <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8 sticky top-4 z-10">
                <h2 className="text-2xl font-semibold mb-4 text-white">Adicionar Novo Produto</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input
                    type="text"
                    value={globalAffiliateIds.amazon}
                    onChange={(e) => setGlobalAffiliateIds(prev => ({...prev, amazon: e.target.value}))}
                    placeholder="Seu ID de Afiliado Amazon (tag)"
                    className="bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    aria-label="Seu ID de Afiliado Amazon (Global)"
                    />
                    <input
                    type="text"
                    value={globalAffiliateIds.mercadoLivre}
                    onChange={(e) => setGlobalAffiliateIds(prev => ({...prev, mercadoLivre: e.target.value}))}
                    placeholder="Seu ID de Afiliado Mercado Livre (afid)"
                    className="bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    aria-label="Seu ID de Afiliado Mercado Livre (Global)"
                    />
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                    <input
                    type="url"
                    value={productUrl}
                    onChange={(e) => setProductUrl(e.target.value)}
                    placeholder="Cole o link do produto aqui (Ex: Amazon)"
                    className="flex-grow bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={isLoading || isUpdatingAll || updatingProductIndex !== null}
                    aria-label="URL do Produto"
                    />
                    <button
                    onClick={handleAddProduct}
                    disabled={isLoading || isUpdatingAll || updatingProductIndex !== null || !productUrl}
                    className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-md transition-colors duration-300 flex items-center justify-center"
                    >
                    {isLoading ? (
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : 'Adicionar'}
                    </button>
                </div>
                {error && !editingState && <p className="text-red-400 mt-4 text-center">{error}</p>}
                </div>
            )}
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-bold text-gray-300">Meus Produtos</h2>
              {isAdminMode && (
                <button
                    onClick={handleUpdateAllProducts}
                    disabled={isLoading || isUpdatingAll || updatingProductIndex !== null || products.length === 0}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors duration-300 flex items-center justify-center gap-2"
                    aria-label="Atualizar preços de todos os produtos"
                >
                    {isUpdatingAll ? (
                    <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Atualizando...</span>
                    </>
                    ) : (
                    <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                        </svg>
                        <span>Atualizar Todos</span>
                    </>
                    )}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product, index) => (
                <ProductCard key={`${product.originalUrl}-${index}`} product={product} index={index} />
              ))}
            </div>
          </main>
        </div>
      </div>
      
      {/* Edit Modal */}
      {editingState && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" aria-modal="true" role="dialog">
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-4">Editar Produto</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="edit-url" className="block text-sm font-medium text-gray-300 mb-1">
                  URL do Produto
                </label>
                <input
                  type="url"
                  id="edit-url"
                  value={editingState.newUrl}
                  onChange={(e) => setEditingState({ ...editingState, newUrl: e.target.value })}
                  className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="edit-affiliate-id-amazon" className="block text-sm font-medium text-gray-300 mb-1">
                  ID de Afiliado Amazon
                </label>
                <input
                  type="text"
                  id="edit-affiliate-id-amazon"
                  value={editingState.newAffiliateIds.amazon}
                  onChange={(e) => setEditingState(prev => prev ? { ...prev, newAffiliateIds: {...prev.newAffiliateIds, amazon: e.target.value } } : null)}
                  placeholder="Deixe em branco para usar o ID global"
                  className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
               <div>
                <label htmlFor="edit-affiliate-id-ml" className="block text-sm font-medium text-gray-300 mb-1">
                  ID de Afiliado Mercado Livre
                </label>
                <input
                  type="text"
                  id="edit-affiliate-id-ml"
                  value={editingState.newAffiliateIds.mercadoLivre}
                  onChange={(e) => setEditingState(prev => prev ? { ...prev, newAffiliateIds: {...prev.newAffiliateIds, mercadoLivre: e.target.value } } : null)}
                  placeholder="Deixe em branco para usar o ID global"
                  className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
            {error && editingState && <p className="text-red-400 mt-4 text-center">{error}</p>}
            <div className="mt-6 flex justify-end gap-4">
              <button
                onClick={() => { setEditingState(null); setError(null); }}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
                disabled={isSavingEdit}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors flex items-center justify-center min-w-[110px]"
                disabled={isSavingEdit}
              >
                {isSavingEdit ? (
                  <>
                    <svg className="animate-spin h-5 w-5 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Salvando...</span>
                  </>
                ) : 'Salvar'}
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