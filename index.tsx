import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

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
}

const App = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [productUrl, setProductUrl] = useState('');
  const [affiliateId, setAffiliateId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Constructs an affiliate URL by appending the affiliate ID.
   * @param url The original product URL.
   * @param storeName The name of the store ("Amazon" or "Mercado Livre").
   * @returns The modified URL with the affiliate tag.
   */
  const constructAffiliateUrl = (url: string, storeName: string): string => {
    if (!affiliateId || !url) return url;
    try {
      const urlObject = new URL(url);
      if (storeName === 'Amazon') {
        urlObject.searchParams.set('tag', affiliateId);
      } else if (storeName === 'Mercado Livre') {
        // This is a common pattern, but real Mercado Livre affiliate links might use a different system.
        urlObject.searchParams.set('afid', affiliateId);
      }
      return urlObject.toString();
    } catch (e) {
      console.error("Invalid URL for affiliate processing:", url);
      return url; // Return original URL if it's invalid
    }
  };

  /**
   * Handles the product addition process.
   * It calls the Gemini API to fetch product details.
   */
  const handleAddProduct = async () => {
    if (!productUrl.trim()) {
      setError("Por favor, insira o URL de um produto.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          productName: { type: Type.STRING, description: "Nome completo do produto." },
          imageUrl: { type: Type.STRING, description: "URL de uma imagem de alta qualidade do produto." },
          stores: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "O nome da loja, 'Amazon' ou 'Mercado Livre'." },
                price: { type: Type.STRING, description: "O preço atual formatado (ex: 'R$ 1.234,56') ou 'N/A' se não encontrado." },
                url: { type: Type.STRING, description: "O link direto para o produto na loja ou 'N/A' se não encontrado." },
              },
              required: ["name", "price", "url"],
            },
          },
        },
        required: ["productName", "imageUrl", "stores"],
      };

      const prompt = `Baseado na URL do produto a seguir, encontre EXATAMENTE o mesmo produto na Amazon Brasil e no Mercado Livre Brasil.
      URL: ${productUrl}

      Retorne o nome do produto, uma URL de imagem de alta qualidade e os preços e links para cada loja no formato JSON especificado. Se não encontrar o produto em uma das lojas, retorne o preço e a URL como 'N/A' para essa loja.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      const jsonString = response.text.trim();
      const newProduct = JSON.parse(jsonString) as Product;

      setProducts(prevProducts => [...prevProducts, newProduct]);
      setProductUrl('');

    } catch (err) {
      console.error(err);
      setError("Não foi possível buscar as informações do produto. Verifique a URL e tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-cyan-400">Price Tracker Pro</h1>
          <p className="text-gray-400 mt-2">Monitore os preços de seus produtos favoritos com links de afiliado.</p>
        </header>

        <main>
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8 sticky top-4 z-10">
            <h2 className="text-2xl font-semibold mb-4 text-white">Adicionar Novo Produto</h2>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
               <input
                type="text"
                value={affiliateId}
                onChange={(e) => setAffiliateId(e.target.value)}
                placeholder="Seu ID de Afiliado (opcional)"
                className="md:col-span-3 bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                aria-label="Seu ID de Afiliado"
              />
            </div>
             <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="Cole o link do produto aqui (Ex: Amazon)"
                className="flex-grow bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-md py-3 px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                disabled={isLoading}
                aria-label="URL do Produto"
              />
              <button
                onClick={handleAddProduct}
                disabled={isLoading || !productUrl}
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
            {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product, index) => (
              <div key={index} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-transform transform hover:scale-105 duration-300 flex flex-col">
                <div className="bg-white p-2 flex-shrink-0">
                    <img src={product.imageUrl} alt={product.productName} className="w-full h-48 object-contain" />
                </div>
                <div className="p-4 flex flex-col flex-grow">
                  <h3 className="font-bold text-lg h-14 overflow-hidden text-gray-200">{product.productName}</h3>
                  <div className="mt-4 space-y-3 flex-grow">
                    {product.stores.map((store, storeIndex) => (
                       store.url && store.price && store.url !== 'N/A' && store.price !== 'N/A' ? (
                        <a
                          key={storeIndex}
                          href={constructAffiliateUrl(store.url, store.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between items-center bg-gray-700 p-3 rounded-md hover:bg-gray-600 transition-colors"
                        >
                          <span className="font-semibold text-gray-300">{store.name}</span>
                          <span className="font-bold text-cyan-400 text-lg">{store.price}</span>
                        </a>
                      ) : (
                         <div key={storeIndex} className="flex justify-between items-center bg-gray-700 p-3 rounded-md opacity-60 cursor-default">
                            <span className="font-semibold text-gray-400">{store.name}</span>
                            <span className="text-sm text-gray-400">Não encontrado</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
