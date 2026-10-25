import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { CartProvider } from './cart/CartContext';
import { Layout } from './components/Layout';
import { About } from './pages/About';
import { Cart } from './pages/Cart';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { ProductDetail } from './pages/ProductDetail';
import { Shop } from './pages/Shop';

export function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} />
            <Route path="shop/:id" element={<ProductDetail />} />
            <Route path="cart" element={<Cart />} />
            <Route path="login" element={<Login />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
