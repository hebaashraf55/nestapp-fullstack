import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { CartProvider } from './cart/CartContext';
import { Layout } from './components/Layout';
import { ShopperProvider } from './shopper/ShopperContext';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { Addresses } from './pages/Addresses';
import { Notifications } from './pages/Notifications';
import { TrackOrder } from './pages/TrackOrder';
import { AdminReturns } from './pages/admin/AdminReturns';
import { Analytics } from './pages/admin/Analytics';
import { Inventory } from './pages/admin/Inventory';
import { ShippingLabel } from './pages/admin/ShippingLabel';
import { Compare } from './pages/Compare';
import { Wishlist } from './pages/Wishlist';
import { Bundles } from './pages/Bundles';
import { LookDetail, Looks } from './pages/Looks';
import { MoodboardDetail, Moodboards, SharedMoodboard } from './pages/Moodboards';
import { AdminBundles } from './pages/admin/AdminBundles';
import { AdminLooks } from './pages/admin/AdminLooks';
import { About } from './pages/About';
import { AdminCoupons } from './pages/admin/AdminCoupons';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrders } from './pages/admin/AdminOrders';
import { AdminProductForm } from './pages/admin/AdminProductForm';
import { AdminProducts } from './pages/admin/AdminProducts';
import { AdminReviews } from './pages/admin/AdminReviews';
import { AuditLog } from './pages/admin/AuditLog';
import { Customers } from './pages/admin/Customers';
import { Dashboard } from './pages/admin/Dashboard';
import { Cart } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { Home } from './pages/Home';
import { ForgotPassword, Register, ResetPassword, VerifyEmail } from './pages/AuthPages';
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
        <ShopperProvider>
        <NotificationsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} />
            <Route path="shop/:id" element={<ProductDetail />} />
            <Route path="wishlist" element={<Wishlist />} />
            <Route path="looks" element={<Looks />} />
            <Route path="looks/:slug" element={<LookDetail />} />
            <Route path="sets" element={<Bundles />} />
            <Route path="moodboards" element={<Moodboards />} />
            <Route path="moodboards/shared/:token" element={<SharedMoodboard />} />
            <Route path="moodboards/:id" element={<MoodboardDetail />} />
            <Route path="compare" element={<Compare />} />
            <Route path="cart" element={<Cart />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="track" element={<TrackOrder />} />
            <Route path="track/:id" element={<TrackOrder />} />
            <Route path="account/addresses" element={<Addresses />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="products/new" element={<AdminProductForm />} />
              <Route path="products/:id" element={<AdminProductForm />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="orders/:id/label" element={<ShippingLabel />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="coupons" element={<AdminCoupons />} />
              <Route path="reviews" element={<AdminReviews />} />
              <Route path="returns" element={<AdminReturns />} />
              <Route path="bundles" element={<AdminBundles />} />
              <Route path="looks" element={<AdminLooks />} />
              <Route path="customers" element={<Customers />} />
              <Route path="audit" element={<AuditLog />} />
            </Route>
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="verify-email" element={<VerifyEmail />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        </NotificationsProvider>
        </ShopperProvider>
      </CartProvider>
    </AuthProvider>
  );
}
