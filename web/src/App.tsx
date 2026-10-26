import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { CartProvider } from './cart/CartContext';
import { Layout } from './components/Layout';
import { About } from './pages/About';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrders } from './pages/admin/AdminOrders';
import { AuditLog } from './pages/admin/AuditLog';
import { Customers } from './pages/admin/Customers';
import { Dashboard } from './pages/admin/Dashboard';
import { Cart } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
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
            <Route path="checkout" element={<Checkout />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="customers" element={<Customers />} />
              <Route path="audit" element={<AuditLog />} />
            </Route>
            <Route path="login" element={<Login />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
