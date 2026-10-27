import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  X,
  ChevronRight,
  CheckCircle2,
  Truck,
  Clock,
  MapPin,
  Wallet,
  Banknote,
  Smartphone,
  Building2,
  CreditCard,
  Copy,
  Check,
  Loader2,
  Ticket,
} from "lucide-react";
import { Logo } from "../Logo";
import type { CartItem } from "../types";
import type { WompiConfigResponse } from "../../services/orders.service";
import {
  validateCoupon,
  type CouponValidation,
} from "../../services/coupons.service";
import { CheckoutAddressMap, type LocateResult } from "./CheckoutAddressMap";

type WompiConfig = WompiConfigResponse;

interface CheckoutModalProps {
  checkoutOpen: boolean;
  checkoutStep: number;
  cartItems: CartItem[];
  cartTotal: number;
  /** Descuento por promociones automáticas (cotización del backend). */
  promotionDiscount?: number;
  checkoutAddress: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    city: string;
    notes: string;
    /** Punto confirmado en el mapa (null = todavía sin ubicar). */
    lat?: number | null;
    lng?: number | null;
  };
  /** El cliente confirmó que el marcador coincide con su dirección. */
  addressConfirmed: boolean;
  onSetAddressConfirmed: (confirmed: boolean) => void;
  savedAddresses?: {
    id: number;
    alias: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    deliveryInstructions: string | null;
    isDefault: boolean;
  }[];
  customerName?: string;
  customerPhone?: string;
  checkoutShipping: "standard" | "express";
  checkoutPayment: "efectivo" | "tarjeta" | "nequi" | "pse" | "breb";
  /** Código del cupón aplicado (vacío si no hay). */
  checkoutCouponCode: string;
  onSetCheckoutCouponCode: (code: string) => void;
  wompiEnabled?: boolean;
  wompiMethods?: { card: boolean; pse: boolean; nequi: boolean };
  brebEnabled?: boolean;
  brebKey?: string;
  brebBank?: string;
  brebQrImageUrl?: string;
  brebQrMime?: string;
  efectivoEnabled?: boolean;
  checkoutLoading: boolean;
  checkoutError: string | null;
  cardPayment: {
    cardholderName: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
    installments: string;
  };
  wompiAcceptance: {
    terms: boolean;
    personalData: boolean;
  };
  wompiConfig: WompiConfig | null;
  psePayment: {
    bank: string;
    personType: "natural" | "juridica";
  };
  nequiPayment: {
    phone: string;
  };
  lastOrderId: string;
  onClose: () => void;
  /** Abre la lista de pedidos del cliente (botón "Ver mis pedidos"). */
  onViewOrders: () => void;
  onSetCheckoutStep: (step: number) => void;
  onSetCheckoutAddress: (
    updater: (
      prev: CheckoutModalProps["checkoutAddress"],
    ) => CheckoutModalProps["checkoutAddress"],
  ) => void;
  onSetCheckoutShipping: (shipping: "standard" | "express") => void;
  onSetCheckoutPayment: (
    payment: "efectivo" | "tarjeta" | "nequi" | "pse" | "breb",
  ) => void;
  onSetCardPayment: (
    updater: (
      prev: CheckoutModalProps["cardPayment"],
    ) => CheckoutModalProps["cardPayment"],
  ) => void;
  onSetWompiAcceptance: (
    updater: (
      prev: CheckoutModalProps["wompiAcceptance"],
    ) => CheckoutModalProps["wompiAcceptance"],
  ) => void;
  onSetPsePayment: (
    updater: (
      prev: CheckoutModalProps["psePayment"],
    ) => CheckoutModalProps["psePayment"],
  ) => void;
  onSetNequiPayment: (
    updater: (
      prev: CheckoutModalProps["nequiPayment"],
    ) => CheckoutModalProps["nequiPayment"],
  ) => void;
  orderPending?: boolean;
  orderDeclineReason?: string | null;
  /** `skipPayment`: el cupón cubre el total, no se cobra por pasarela. */
  onPlaceOrder: (options?: { skipPayment?: boolean }) => Promise<void>;
  fmt: (n: number) => string;
  /** Pide la ubicación al teléfono del cliente (para PCs). */
  onRequestLocation?: () => Promise<{ lat: number; lng: number } | null>;
  /** Si el dispositivo actual es un teléfono (GPS fiable). */
  isMobileDevice?: boolean;
}

export function CheckoutModal({
  checkoutOpen,
  checkoutStep,
  cartItems,
  cartTotal,
  promotionDiscount = 0,
  checkoutAddress,
  addressConfirmed,
  onSetAddressConfirmed,
  savedAddresses = [],
  customerName = "",
  customerPhone = "",
  checkoutShipping,
  checkoutPayment,
  checkoutCouponCode,
  onSetCheckoutCouponCode,
  checkoutLoading,
  checkoutError,
  cardPayment,
  wompiAcceptance,
  wompiConfig,
  wompiEnabled = true,
  wompiMethods = { card: true, pse: true, nequi: true },
  brebEnabled = true,
  brebKey = "@davi3148853458",
  brebBank = "Davivienda",
  brebQrImageUrl = "",
  brebQrMime = "",
  efectivoEnabled = true,
  psePayment,
  nequiPayment,
  lastOrderId,
  orderPending,
  orderDeclineReason,
  onClose,
  onViewOrders,
  onSetCheckoutStep,
  onSetCheckoutAddress,
  onSetCheckoutShipping,
  onSetCheckoutPayment,
  onSetCardPayment,
  onSetWompiAcceptance,
  onSetPsePayment,
  onSetNequiPayment,
  onPlaceOrder,
  fmt,
  onRequestLocation,
  isMobileDevice = true,
}: CheckoutModalProps) {
  if (!checkoutOpen) return null;

  const [copied, setCopied] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [usingNewAddress, setUsingNewAddress] = useState(false);
  // Petición al mapa para ubicar sola la dirección elegida (ver
  // CheckoutAddressMap). El token fuerza una nueva ubicación al re-elegir la
  // misma dirección.
  const [locateRequest, setLocateRequest] = useState<{
    address: string;
    token: number;
  } | null>(null);
  const locateTokenRef = useRef(0);
  // Última dirección que ya se ubicó en el mapa (evita repetir la petición).
  const lastLocatedAddressRef = useRef<string | null>(null);
  /**
   * Validación de la dirección escrita: `checking` mientras el mapa la resuelve,
   * `ok` con la dirección corta que devolvió el geocoder, `error` si no la
   * encontró (ahí el cliente debe corregirla o marcar el punto a mano).
   */
  const [addressCheck, setAddressCheck] = useState<{
    status: "idle" | "checking" | "ok" | "error";
    resolved?: string;
  }>({ status: "idle" });

  /** Pide al mapa ubicar esa dirección y dejar el marcador puesto. */
  const requestLocate = useCallback((address: string) => {
    const value = address.trim();
    if (value.length < 6 || value === lastLocatedAddressRef.current) return;
    lastLocatedAddressRef.current = value;
    locateTokenRef.current += 1;
    setAddressCheck({ status: "checking" });
    setLocateRequest({ address: value, token: locateTokenRef.current });
  }, []);

  /** El mapa resolvió (o no) la dirección: se avisa junto al campo. */
  const handleLocateResult = (result: LocateResult) => {
    setAddressCheck(
      result.ok
        ? { status: "ok", resolved: result.resolved }
        : { status: "error" },
    );
  };

  /** Ubica en el mapa la dirección escrita en el formulario. */
  const locateTypedAddress = () => {
    requestLocate(
      [checkoutAddress.address, checkoutAddress.city].filter(Boolean).join(", "),
    );
  };

  // Ubica la dirección mientras el cliente la escribe, con una pausa: así el
  // marcador aparece solo al dejar de teclear y no se consulta el geocoder en
  // cada letra (el proveedor limita a 1 petición por segundo).
  useEffect(() => {
    if (!usingNewAddress && savedAddresses.length > 0) return;
    const address = [checkoutAddress.address, checkoutAddress.city]
      .filter(Boolean)
      .join(", ")
      .trim();
    if (address.length < 8) return;
    const timer = setTimeout(() => requestLocate(address), 900);
    return () => clearTimeout(timer);
  }, [
    checkoutAddress.address,
    checkoutAddress.city,
    usingNewAddress,
    savedAddresses.length,
    requestLocate,
  ]);
  // Cupón: el input es local y solo se propaga al estado del checkout cuando
  // el backend lo acepta, para no enviar códigos inválidos en el pedido.
  const [couponInput, setCouponInput] = useState(checkoutCouponCode);
  const [couponPreview, setCouponPreview] = useState<CouponValidation | null>(
    null,
  );
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // El cupón se calcula sobre el subtotal después de promociones automáticas
  // (igual que el backend al crear el pedido).
  const couponBase = Math.max(0, cartTotal - promotionDiscount);

  // Revalida el cupón ya aplicado (se conserva entre pasos del checkout).
  useEffect(() => {
    if (!checkoutCouponCode) {
      setCouponPreview(null);
      return;
    }
    let cancelled = false;
    validateCoupon(checkoutCouponCode, couponBase).then((result) => {
      if (cancelled) return;
      if (result.valid) {
        setCouponPreview(result);
        setCouponError(null);
      } else {
        setCouponPreview(null);
        setCouponError(result.reason ?? "Cupón no válido");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [checkoutCouponCode, couponBase]);

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || couponChecking) return;
    setCouponChecking(true);
    setCouponError(null);
    const result = await validateCoupon(code, couponBase);
    setCouponChecking(false);
    if (!result.valid) {
      setCouponPreview(null);
      setCouponError(result.reason ?? "Cupón no válido");
      onSetCheckoutCouponCode("");
      return;
    }
    setCouponPreview(result);
    setCouponInput(code);
    onSetCheckoutCouponCode(code);
  };

  const clearCoupon = () => {
    setCouponInput("");
    setCouponPreview(null);
    setCouponError(null);
    onSetCheckoutCouponCode("");
  };

  const shippingRate = checkoutShipping === "express" ? 9900 : 4900;
  const couponDiscountApplied = Math.min(
    couponPreview?.discountAmount ?? 0,
    couponBase,
  );
  // Total antes del saldo del cupón (lo que el backend llama grandTotal).
  const totalConEnvio =
    Math.max(0, couponBase - couponDiscountApplied) + shippingRate;
  // El saldo del cupón paga el resto, incluido el envío.
  const couponBalanceApplied = Math.min(
    couponPreview?.balance ?? 0,
    totalConEnvio,
  );
  const amountToPay = Math.max(0, totalConEnvio - couponBalanceApplied);
  const fullyPaidByCoupon = amountToPay <= 0 && couponBalanceApplied > 0;

  // Normaliza el teléfono a dígitos (móvil colombiano 3xx xxx xxxx)
  const normalizePhone = (raw: string) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("57") && digits.length === 12) digits = digits.slice(2);
    return digits.slice(0, 10);
  };
  const isValidPhone = (phone: string) => /^3\d{9}$/.test(normalizePhone(phone));
  const isValidEmail = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const selectSavedAddress = (id: number) => {
    const addr = savedAddresses.find((a) => a.id === id);
    if (!addr) return;
    setSelectedAddressId(id);
    setUsingNewAddress(false);
    // La dirección guardada se ubica sola en el mapa: el cliente solo confirma
    // que el marcador corresponde a su dirección.
    onSetAddressConfirmed(false);
    onSetCheckoutAddress((prev) => ({
      ...prev,
      name: prev.name || customerName,
      phone: prev.phone || customerPhone,
      address: [addr.addressLine1, addr.addressLine2]
        .filter(Boolean)
        .join(", "),
      city: addr.city,
      notes: prev.notes || addr.deliveryInstructions || "",
      lat: null,
      lng: null,
    }));
    requestLocate(
      [addr.addressLine1, addr.addressLine2, addr.city]
        .filter(Boolean)
        .join(", "),
    );
  };

  const switchToNewAddress = () => {
    setUsingNewAddress(true);
    setSelectedAddressId(null);
    setLocateRequest(null);
    setAddressCheck({ status: "idle" });
    onSetAddressConfirmed(false);
  };

  const paymentLabel: Record<string, string> = {
    efectivo: "Efectivo contra entrega",
    tarjeta: "Tarjeta débito / crédito",
    nequi: "Nequi",
    pse: "PSE",
    breb: "Bre-B",
  };

  const handleCopyLlave = () => {
    navigator.clipboard.writeText(brebKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Un QR en PDF no se renderiza en <img>: se muestra en <iframe>
  const brebQrIsPdf =
    brebQrMime === "application/pdf" ||
    brebQrImageUrl.startsWith("data:application/pdf");

  // Métodos de pago filtrados según config de Wompi
  const allMethods = [
    { key: "efectivo" as const, label: "Efectivo contra entrega", Icon: Banknote, desc: "Paga al recibir tu pedido", enabled: efectivoEnabled },
    { key: "nequi" as const, label: "Nequi", Icon: Smartphone, desc: "Transferencia inmediata", enabled: wompiEnabled && wompiMethods.nequi },
    { key: "pse" as const, label: "PSE", Icon: Building2, desc: "Débito bancario en línea", enabled: wompiEnabled && wompiMethods.pse },
    { key: "tarjeta" as const, label: "Tarjeta débito / crédito", Icon: CreditCard, desc: "Visa, Mastercard, Amex", enabled: wompiEnabled && wompiMethods.card },
    { key: "breb" as const, label: "Bre-B (Transferencia entre bancos)", Icon: Building2, desc: `Transfiere a ${brebKey}`, enabled: brebEnabled },
  ];
  const paymentMethods = allMethods.filter((m) => m.enabled);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-muted overflow-y-auto pb-[var(--safe-bottom)]">
      <div className="bg-white border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        {checkoutStep < 4 && (
          <button
            onClick={() =>
              checkoutStep === 1
                ? onClose()
                : onSetCheckoutStep(checkoutStep - 1)
            }
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex-1">
          <Logo dark={true} />
        </div>
        {checkoutStep < 4 && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {checkoutStep < 4 && (
        <div className="bg-white px-6 pb-4 pt-2 flex items-center gap-2 border-b border-border">
          {["Resumen", "Dirección", "Pago"].map((label, i) => {
            const step = i + 1;
            const active = checkoutStep === step;
            const done = checkoutStep > step;
            return (
              <div key={step} className="flex items-center gap-2 shrink-0">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={
                    done
                      ? { background: "#34C759", color: "#fff" }
                      : active
                        ? { background: "var(--secondary)", color: "var(--primary)" }
                        : { background: "var(--muted)", color: "var(--muted-foreground)" }
                  }
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : step}
                </div>
                <span
                  className={`text-xs font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {label}
                </span>
                {i < 2 && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-4">
        {checkoutStep === 1 && (
          <>
            <h2
              className="text-xl font-black"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              Resumen del pedido
            </h2>
            <div className="bg-white rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-14 h-14 object-cover rounded-xl"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.unit} × {item.quantity}
                    </p>
                  </div>
                  <span className="text-sm font-bold shrink-0">
                    {fmt(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-bold">Tipo de envío</h3>
              {(["standard", "express"] as const).map((type) => (
                <label
                  key={type}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${checkoutShipping === type ? "border-yellow-300 bg-yellow-50" : "border-border hover:bg-muted/40"}`}
                >
                  <input
                    type="radio"
                    name="shipping"
                    value={type}
                    checked={checkoutShipping === type}
                    onChange={() => onSetCheckoutShipping(type)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${checkoutShipping === type ? "border-yellow-500" : "border-muted-foreground"}`}
                  >
                    {checkoutShipping === type && (
                      <div className="w-2 h-2 rounded-full bg-foreground" />
                    )}
                  </div>
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {type === "standard"
                        ? "Envío estándar"
                        : "Envío express"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {type === "standard"
                        ? "2-3 horas hábiles"
                        : "45-60 minutos"}
                    </p>
                  </div>
                  <span className="text-sm font-bold">
                    {fmt(type === "standard" ? 4900 : 9900)}
                  </span>
                </label>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold">{fmt(cartTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Envío</span>
                <span className="font-semibold">{fmt(shippingRate)}</span>
              </div>
              {promotionDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento promociones</span>
                  <span className="font-semibold">-{fmt(promotionDiscount)}</span>
                </div>
              )}
              {couponDiscountApplied > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento cupón</span>
                  <span className="font-semibold">-{fmt(couponDiscountApplied)}</span>
                </div>
              )}
              {couponBalanceApplied > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Saldo del cupón</span>
                  <span className="font-semibold">-{fmt(couponBalanceApplied)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base border-t border-border pt-2">
                <span>Total</span>
                <span>{fmt(amountToPay)}</span>
              </div>
            </div>
            <button
              onClick={() => onSetCheckoutStep(2)}
              className="w-full py-4 rounded-2xl font-black text-base hover:brightness-95 active:scale-95 transition-all"
              style={{ background: "var(--secondary)", color: "var(--primary)" }}
            >
              Continuar con la dirección →
            </button>
          </>
        )}

        {checkoutStep === 2 && (
          <>
            <h2
              className="text-xl font-black"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              Dirección de entrega
            </h2>

            {/* Direcciones guardadas */}
            {savedAddresses.length > 0 && !usingNewAddress && (
              <div className="space-y-2">
                {savedAddresses.map((a) => {
                  const selected = selectedAddressId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => selectSavedAddress(a.id)}
                      className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all ${
                        selected
                          ? "border-yellow-400 bg-yellow-50"
                          : "border-border bg-white hover:bg-muted/40"
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selected ? "border-yellow-500" : "border-muted-foreground"
                        }`}
                      >
                        {selected && (
                          <div className="w-2 h-2 rounded-full bg-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold flex items-center gap-2">
                          {a.alias || "Dirección"}
                          {a.isDefault && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "var(--primary)", color: "var(--foreground)" }}
                            >
                              Predeterminada
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {[a.addressLine1, a.addressLine2, a.city]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                        {a.deliveryInstructions && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            📝 {a.deliveryInstructions}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={switchToNewAddress}
                  className="w-full text-center px-4 py-2.5 rounded-2xl border border-dashed border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  + Usar otra dirección
                </button>
              </div>
            )}

            {/* Completar nombre/celular/email cuando se elige una guardada */}
            {selectedAddressId !== null && !usingNewAddress && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Confirma tus datos de contacto
                </p>
                {([
                  {
                    key: "name" as const,
                    label: "Nombre completo",
                    placeholder: "Carlos Ríos",
                    type: "text",
                  },
                  {
                    key: "phone" as const,
                    label: "Celular",
                    placeholder: "300 123 4567",
                    type: "tel",
                  },
                  {
                    key: "email" as const,
                    label: "Email",
                    placeholder: "correo@ejemplo.com",
                    type: "email",
                  },
                ]).map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold block mb-1">
                      {label}
                    </label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={checkoutAddress[key]}
                      onChange={(e) =>
                        onSetCheckoutAddress((prev) => ({
                          ...prev,
                          [key]:
                            key === "phone"
                              ? normalizePhone(e.target.value)
                              : e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                    />
                    {key === "phone" &&
                      checkoutAddress.phone &&
                      !isValidPhone(checkoutAddress.phone) && (
                        <p className="text-xs text-red-500 mt-1">
                          Ingresa un celular válido (10 dígitos, ej: 300 123
                          4567)
                        </p>
                      )}
                    {key === "email" &&
                      checkoutAddress.email &&
                      !isValidEmail(checkoutAddress.email) && (
                        <p className="text-xs text-red-500 mt-1">
                          Ingresa un email válido
                        </p>
                      )}
                  </div>
                ))}
              </div>
            )}

            {/* Formulario manual (nueva dirección o sin guardadas) */}
            {(usingNewAddress || savedAddresses.length === 0) && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                {([
                  {
                    key: "name" as const,
                    label: "Nombre completo",
                    placeholder: "Carlos Ríos",
                    type: "text",
                  },
                  {
                    key: "phone" as const,
                    label: "Celular",
                    placeholder: "300 123 4567",
                    type: "tel",
                  },
                  {
                    key: "email" as const,
                    label: "Email",
                    placeholder: "correo@ejemplo.com",
                    type: "email",
                  },
                  {
                    key: "address" as const,
                    label: "Dirección",
                    placeholder: "Cra 23 #45-67, Barrio San José",
                    type: "text",
                  },
                  {
                    key: "city" as const,
                    label: "Ciudad",
                    placeholder: "Manizales",
                    type: "text",
                  },
                  {
                    key: "notes" as const,
                    label: "Indicaciones adicionales (opcional)",
                    placeholder: "Apto 301, timbre no funciona...",
                    type: "text",
                  },
                ]).map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold block mb-1">
                      {label}
                    </label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={checkoutAddress[key]}
                      onChange={(e) => {
                        // Cambiar la dirección o la ciudad invalida el punto
                        // confirmado: hay que volver a ubicarlo en el mapa.
                        if (key === "address" || key === "city") {
                          onSetAddressConfirmed(false);
                          setAddressCheck({ status: "idle" });
                          onSetCheckoutAddress((prev) => ({
                            ...prev,
                            lat: null,
                            lng: null,
                          }));
                        }
                        onSetCheckoutAddress((prev) => ({
                          ...prev,
                          [key]:
                            key === "phone"
                              ? normalizePhone(e.target.value)
                              : e.target.value,
                        }));
                      }}
                      onKeyDown={(e) => {
                        // Enter ubica la dirección sin salir del formulario.
                        if (
                          (key === "address" || key === "city") &&
                          e.key === "Enter"
                        ) {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                      onFocus={(e) => {
                        e.target.style.boxShadow = "0 0 0 2px #FFF200";
                        e.target.style.borderColor = "var(--primary)";
                      }}
                      onBlur={(e) => {
                        e.target.style.boxShadow = "none";
                        e.target.style.borderColor = "";
                        // Al salir del campo, el mapa ubica lo que escribió
                        // (la ciudad afina el resultado del geocoder).
                        if (key === "address" || key === "city") {
                          locateTypedAddress();
                        }
                      }}
                    />
                    {key === "address" && addressCheck.status === "checking" && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Ubicando la dirección en el mapa…
                      </p>
                    )}
                    {key === "address" && addressCheck.status === "error" && (
                      <p className="text-xs text-amber-600 mt-1">
                        No pudimos ubicar esa dirección en el mapa. Revisa el
                        texto (calle, número y ciudad) o toca el mapa para marcar
                        el punto.
                      </p>
                    )}
                    {key === "address" && addressCheck.status === "ok" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Ubicada en el mapa:{" "}
                        <span className="font-semibold text-foreground">
                          {addressCheck.resolved}
                        </span>
                        . Revisa que el marcador quede en tu dirección.
                      </p>
                    )}
                    {key === "phone" &&
                      checkoutAddress.phone &&
                      !isValidPhone(checkoutAddress.phone) && (
                        <p className="text-xs text-red-500 mt-1">
                          Ingresa un celular válido (10 dígitos, ej: 300 123
                          4567)
                        </p>
                      )}
                    {key === "email" &&
                      checkoutAddress.email &&
                      !isValidEmail(checkoutAddress.email) && (
                        <p className="text-xs text-red-500 mt-1">
                          Ingresa un email válido
                        </p>
                      )}
                  </div>
                ))}
                {usingNewAddress && (
                  <button
                    type="button"
                    onClick={() => {
                      setUsingNewAddress(false);
                      if (selectedAddressId !== null) {
                        selectSavedAddress(selectedAddressId);
                      } else if (savedAddresses.length > 0) {
                        selectSavedAddress(
                          savedAddresses.find((a) => a.isDefault)?.id ??
                            savedAddresses[0].id,
                        );
                      }
                    }}
                    className="w-full text-center px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Volver a mis direcciones
                  </button>
                )}
              </div>
            )}
            {/* Mapa: ubicar el punto exacto y confirmar que coincide */}
            <CheckoutAddressMap
              coords={
                checkoutAddress.lat != null && checkoutAddress.lng != null
                  ? { lat: checkoutAddress.lat, lng: checkoutAddress.lng }
                  : null
              }
              confirmed={addressConfirmed}
              onCoordsChange={(c) => {
                onSetCheckoutAddress((prev) => ({
                  ...prev,
                  lat: c?.lat ?? null,
                  lng: c?.lng ?? null,
                }));
                // Mover el marcador invalida la confirmación anterior.
                onSetAddressConfirmed(false);
              }}
              onPickAddress={({ address, city }) =>
                onSetCheckoutAddress((prev) => ({
                  ...prev,
                  address,
                  city: city || prev.city,
                }))
              }
              onConfirmedChange={onSetAddressConfirmed}
              onLocateResult={handleLocateResult}
              locateRequest={locateRequest}
              onRequestLocation={onRequestLocation}
              isMobile={isMobileDevice}
            />

            {!addressConfirmed && (
              <p className="text-xs text-muted-foreground text-center">
                Ubica tu dirección en el mapa y confírmala para poder continuar.
              </p>
            )}
            <button
              onClick={() => onSetCheckoutStep(3)}
              disabled={
                !checkoutAddress.name ||
                !isValidPhone(checkoutAddress.phone) ||
                !isValidEmail(checkoutAddress.email || "") ||
                !checkoutAddress.address ||
                checkoutAddress.lat == null ||
                checkoutAddress.lng == null ||
                !addressConfirmed
              }
              className="w-full py-4 rounded-2xl font-black text-base hover:brightness-95 active:scale-95 transition-all disabled:opacity-40"
              style={{ background: "var(--secondary)", color: "var(--primary)" }}
            >
              Continuar con el pago →
            </button>
          </>
        )}

        {checkoutStep === 3 && (
          <>
            <h2
              className="text-xl font-black"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              Método de pago
            </h2>
            <div className="bg-white rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {paymentMethods.map(({ key, label, Icon, desc }) => (
                <label
                  key={key}
                  className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors ${checkoutPayment === key ? "bg-yellow-50" : "hover:bg-muted/40"}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={key}
                    checked={checkoutPayment === key}
                    onChange={() => onSetCheckoutPayment(key)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${checkoutPayment === key ? "border-yellow-500" : "border-muted-foreground"}`}
                  >
                    {checkoutPayment === key && (
                      <div className="w-2 h-2 rounded-full bg-foreground" />
                    )}
                  </div>
                  <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {checkoutPayment === "tarjeta" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-bold">Datos de la tarjeta</h3>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Nombre del titular
                  </label>
                  <input
                    type="text"
                    value={cardPayment.cardholderName}
                    onChange={(e) =>
                      onSetCardPayment((prev) => ({
                        ...prev,
                        cardholderName: e.target.value,
                      }))
                    }
                    placeholder="Nombre como aparece en la tarjeta"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Número de tarjeta
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={19}
                    value={cardPayment.cardNumber}
                    onChange={(e) =>
                      onSetCardPayment((prev) => ({
                        ...prev,
                        cardNumber: e.target.value
                          .replace(/\D/g, "")
                          .slice(0, 16)
                          .replace(/(.{4})/g, "$1 ")
                          .trim(),
                      }))
                    }
                    placeholder="1234 5678 9012 3456"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold block mb-1">
                      Vencimiento (MM/AA)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      value={
                        cardPayment.expiryYear
                          ? `${cardPayment.expiryMonth}/${cardPayment.expiryYear}`
                          : cardPayment.expiryMonth
                      }
                      onChange={(e) => {
                        const digits = e.target.value
                          .replace(/\D/g, "")
                          .slice(0, 4);
                        onSetCardPayment((prev) => ({
                          ...prev,
                          expiryMonth: digits.slice(0, 2),
                          expiryYear: digits.slice(2),
                        }));
                      }}
                      placeholder="08/29"
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold block mb-1">
                      CVV
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={cardPayment.cvv}
                      onChange={(e) =>
                        onSetCardPayment((prev) => ({
                          ...prev,
                          cvv: e.target.value.replace(/\D/g, "").slice(0, 4),
                        }))
                      }
                      placeholder="123"
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Cuotas
                  </label>
                  <select
                    value={cardPayment.installments}
                    onChange={(e) =>
                      onSetCardPayment((prev) => ({
                        ...prev,
                        installments: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                  >
                    {[1, 2, 3, 6, 12].map((value) => (
                      <option key={value} value={String(value)}>
                        {value} cuota{value > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={wompiAcceptance.terms}
                      onChange={(e) =>
                        onSetWompiAcceptance((prev) => ({
                          ...prev,
                          terms: e.target.checked,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Acepto los{" "}
                      <a
                        href={wompiConfig?.acceptancePermalink ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-foreground"
                      >
                        términos y condiciones de Wompi
                      </a>
                      .
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={wompiAcceptance.personalData}
                      onChange={(e) =>
                        onSetWompiAcceptance((prev) => ({
                          ...prev,
                          personalData: e.target.checked,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Autorizo el tratamiento de datos personales según{" "}
                      <a
                        href={
                          wompiConfig?.personalDataAuthPermalink ?? "#"
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-foreground"
                      >
                        la política de Wompi
                      </a>
                      .
                    </span>
                  </label>
                </div>
              </div>
            )}

            {checkoutPayment === "pse" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-bold">Pago con PSE</h3>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Banco
                  </label>
                  <select
                    value={psePayment.bank}
                    onChange={(e) =>
                      onSetPsePayment((prev) => ({
                        ...prev,
                        bank: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                  >
                    <option value="">Selecciona un banco</option>
                    <option value="bancolombia">Bancolombia</option>
                    <option value="davivienda">Davivienda</option>
                    <option value="bbva">BBVA</option>
                    <option value="bogota">Banco de Bogotá</option>
                    <option value="occidente">Banco de Occidente</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Tipo de persona
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["natural", "juridica"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          onSetPsePayment((prev) => ({
                            ...prev,
                            personType: type,
                          }))
                        }
                        className={`px-3 py-2.5 rounded-xl border text-sm font-semibold ${psePayment.personType === type ? "border-yellow-400 bg-yellow-50" : "border-border bg-white"}`}
                      >
                        {type === "natural"
                          ? "Persona natural"
                          : "Persona jurídica"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {checkoutPayment === "nequi" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-bold">Pago con Nequi</h3>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Número asociado a Nequi
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={nequiPayment.phone}
                    onChange={(e) =>
                      onSetNequiPayment({
                        phone: normalizePhone(e.target.value),
                      })
                    }
                    placeholder="3001234567"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
                  />
                  {nequiPayment.phone && !isValidPhone(nequiPayment.phone) && (
                    <p className="text-xs text-red-500 mt-1">
                      Ingresa un celular válido (10 dígitos, ej: 300 123 4567)
                    </p>
                  )}
                </div>
              </div>
            )}

            {checkoutPayment === "breb" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-bold">Pago con Bre-B</h3>
                <p className="text-xs text-muted-foreground">
                  Transfiere el monto exacto a la siguiente llave desde la app de tu banco.
                </p>
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Llave</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-foreground">{brebKey}</span>
                      <button
                        onClick={handleCopyLlave}
                        className="p-1 rounded-lg hover:bg-muted transition-colors"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Banco</span>
                    <span className="text-sm font-semibold text-foreground">{brebBank}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Monto a transferir</span>
                    <span className="text-sm font-bold text-foreground">{fmt(amountToPay)}</span>
                  </div>
                  {brebQrImageUrl && (
                    <div className="flex justify-center pt-2">
                      {brebQrIsPdf ? (
                        <iframe
                          src={brebQrImageUrl}
                          title="QR de pago"
                          className="w-40 h-40 rounded-lg border border-border bg-white"
                        />
                      ) : (
                        <img
                          src={brebQrImageUrl}
                          alt="QR de pago"
                          className="w-40 h-40 object-contain rounded-lg border border-border"
                        />
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-2">
                  Tu pedido se confirmará cuando verifiquemos la transferencia. Usa el código de referencia como concepto.
                </p>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-bold">¿Tienes un cupón?</p>
              </div>
              {couponPreview ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-green-700 truncate">
                      {checkoutCouponCode}
                    </p>
                    <p className="text-xs text-green-700">
                      {couponDiscountApplied > 0 &&
                        `Descuento ${fmt(couponDiscountApplied)}`}
                      {couponDiscountApplied > 0 && couponBalanceApplied > 0 && " · "}
                      {couponBalanceApplied > 0 &&
                        `Saldo aplicado ${fmt(couponBalanceApplied)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearCoupon}
                    className="shrink-0 text-xs font-bold text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value.toUpperCase());
                        setCouponError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void applyCoupon();
                        }
                      }}
                      placeholder="CUP-XXXX-XXXX"
                      autoCapitalize="characters"
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm font-mono uppercase focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void applyCoupon()}
                      disabled={!couponInput.trim() || couponChecking}
                      className="shrink-0 px-4 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "var(--secondary)", color: "var(--primary)" }}
                    >
                      {couponChecking ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Aplicar"
                      )}
                    </button>
                  </div>
                  {couponError && (
                    <p className="text-xs text-red-500">{couponError}</p>
                  )}
                </>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{fmt(cartTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Envío</span>
                <span>{fmt(shippingRate)}</span>
              </div>
              {promotionDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento promociones</span>
                  <span className="font-semibold">-{fmt(promotionDiscount)}</span>
                </div>
              )}
              {couponDiscountApplied > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento cupón</span>
                  <span className="font-semibold">-{fmt(couponDiscountApplied)}</span>
                </div>
              )}
              {couponBalanceApplied > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Saldo del cupón</span>
                  <span className="font-semibold">-{fmt(couponBalanceApplied)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base border-t border-border pt-2">
                <span>Total a pagar</span>
                <span>{fmt(amountToPay)}</span>
              </div>
            </div>
            {checkoutError && (
              <div className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2 text-center">
                {checkoutError}
              </div>
            )}
            <button
              onClick={() => onPlaceOrder({ skipPayment: fullyPaidByCoupon })}
              disabled={
                checkoutLoading ||
                (!fullyPaidByCoupon &&
                  checkoutPayment === "tarjeta" &&
                  (!cardPayment.cardholderName ||
                    !cardPayment.cardNumber ||
                    !cardPayment.expiryMonth ||
                    !cardPayment.expiryYear ||
                    !cardPayment.cvv ||
                    !wompiAcceptance.terms ||
                    !wompiAcceptance.personalData)) ||
                (!fullyPaidByCoupon &&
                  checkoutPayment === "pse" &&
                  !psePayment.bank) ||
                (!fullyPaidByCoupon &&
                  checkoutPayment === "nequi" &&
                  !isValidPhone(nequiPayment.phone))
              }
              className="w-full py-4 rounded-2xl font-black text-base hover:brightness-95 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--primary)", color: "var(--foreground)" }}
            >
              {checkoutLoading
                ? "Procesando pedido..."
                : "Confirmar pedido →"}
            </button>
          </>
        )}

        {checkoutStep === 4 && (
          <div className="flex flex-col items-center text-center py-10 gap-5">
            {orderDeclineReason ? (
              <>
                <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                  <X className="w-10 h-10 text-red-500" />
                </div>
                <div>
                  <h2
                    className="text-2xl font-black"
                    style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                  >
                    Pago rechazado
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Tu pedido <strong>{lastOrderId}</strong> no pudo ser procesado.
                  </p>
                  <p className="text-red-500 text-xs mt-1 font-medium">
                    {orderDeclineReason}
                  </p>
                </div>
              </>
            ) : orderPending ? (
              <>
                <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
                  <Clock className="w-10 h-10 text-amber-500" />
                </div>
                <div>
                  <h2
                    className="text-2xl font-black"
                    style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                  >
                    {checkoutPayment === "breb" ? "Pendiente de transferencia" : "Pago pendiente de confirmación"}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {checkoutPayment === "breb"
                      ? `Transfiere ${fmt(amountToPay)} a la llave ${brebKey} (${brebBank}) y tu pedido será confirmado.`
                      : `Tu pedido ${lastOrderId} está siendo procesado por Wompi.`}
                  </p>
                  {checkoutPayment === "breb" && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Llave</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold">{brebKey}</span>
                          <button onClick={handleCopyLlave} className="p-1 rounded-lg hover:bg-amber-100">
                            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Referencia</span>
                        <span className="text-sm font-bold">{lastOrderId}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Monto</span>
                        <span className="text-sm font-bold">{fmt(amountToPay)}</span>
                      </div>
                      {brebQrImageUrl && (
                        <div className="flex justify-center pt-2">
                          {brebQrIsPdf ? (
                            <iframe
                              src={brebQrImageUrl}
                              title="QR de pago"
                              className="w-36 h-36 rounded-lg border border-amber-200 bg-white"
                            />
                          ) : (
                            <img
                              src={brebQrImageUrl}
                              alt="QR de pago"
                              className="w-36 h-36 object-contain rounded-lg border border-amber-200"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {checkoutPayment !== "breb" && (
                    <p className="text-muted-foreground text-xs mt-1">
                      Te notificaremos cuando el pago sea confirmado.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                </div>
                <div>
                  <h2
                    className="text-2xl font-black"
                    style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                  >
                    ¡Pedido confirmado!
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Tu pedido <strong>{lastOrderId}</strong> ha sido recibido.
                  </p>
                </div>
              </>
            )}
            <div className="bg-white rounded-2xl border border-border p-4 w-full text-left space-y-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  {checkoutShipping === "express"
                    ? "Entrega en 45-60 minutos"
                    : "Entrega en 2-3 horas"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  {checkoutAddress.address}, {checkoutAddress.city}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>{paymentLabel[checkoutPayment] || checkoutPayment}</span>
              </div>
            </div>
            <button
              onClick={onViewOrders}
              className="w-full py-4 rounded-2xl font-black text-base hover:brightness-95 active:scale-95 transition-all"
              style={{ background: "var(--secondary)", color: "var(--primary)" }}
            >
              Ver mis pedidos
            </button>
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Seguir comprando
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
