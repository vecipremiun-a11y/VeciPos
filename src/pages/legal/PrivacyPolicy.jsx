import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';

// Política de Privacidad pública (/privacidad). Se enlaza desde el registro.
// Documento informativo adaptado al funcionamiento real de POSVECI; revisar
// con asesoría legal antes de cambios de fondo.

const LAST_UPDATE = '14 de julio de 2026';
const CONTACT_EMAIL = 'soporte@posveci.com';

const Section = ({ number, title, children }) => (
    <section className="space-y-3">
        <h2 className="text-lg font-bold text-[var(--color-text)]">
            <span className="text-[var(--color-primary)] mr-2">{number}.</span>
            {title}
        </h2>
        <div className="space-y-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
            {children}
        </div>
    </section>
);

const PrivacyPolicy = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[var(--color-bg)] py-10 px-4">
            <div className="max-w-3xl mx-auto">
                <button
                    onClick={() => navigate(-1)}
                    className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline"
                >
                    <ArrowLeft size={16} /> Volver
                </button>

                <div className="glass-card p-8 md:p-10 space-y-8">
                    {/* Encabezado */}
                    <header className="space-y-3 border-b border-[var(--glass-border)] pb-6">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                            <Shield size={24} className="text-white" />
                        </div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[var(--color-text)]">
                            Política de Privacidad de POSVECI
                        </h1>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            Última actualización: {LAST_UPDATE}
                        </p>
                        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                            En POSVECI («la Plataforma», «nosotros») nos tomamos en serio la privacidad de
                            quienes usan nuestro sistema de punto de venta y gestión comercial. Esta política
                            explica qué datos recopilamos, con qué finalidad, cómo los protegemos y qué
                            derechos tienes sobre ellos. Al crear una cuenta o usar la Plataforma aceptas
                            las prácticas descritas en este documento.
                        </p>
                    </header>

                    <Section number="1" title="Quiénes somos y alcance">
                        <p>
                            POSVECI es una plataforma de punto de venta (POS) y gestión comercial en la nube
                            orientada a comercios de Chile y Latinoamérica. Incluye módulos de ventas,
                            inventario, clientes, proveedores, personal y asistencia, finanzas, emisión de
                            documentos tributarios electrónicos y venta web.
                        </p>
                        <p>
                            Esta política aplica a los sitios y aplicaciones de POSVECI (incluidos
                            app.posveci.com y demo.posveci.com) y a los servicios asociados. No aplica a
                            sitios de terceros enlazados desde la Plataforma.
                        </p>
                    </Section>

                    <Section number="2" title="Doble rol: responsable y encargado de los datos">
                        <p>
                            Es importante distinguir dos tipos de datos dentro de POSVECI:
                        </p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>
                                <strong className="text-[var(--color-text)]">Datos de tu cuenta:</strong>{' '}
                                los datos que entregas al registrarte y contratar el servicio (datos de la
                                empresa y del administrador). Respecto de estos datos, POSVECI actúa como{' '}
                                <strong className="text-[var(--color-text)]">responsable del tratamiento</strong>.
                            </li>
                            <li>
                                <strong className="text-[var(--color-text)]">Datos que tu negocio carga en la Plataforma:</strong>{' '}
                                información de tus clientes, empleados, ventas y proveedores. Estos datos
                                pertenecen a tu empresa; POSVECI los procesa únicamente por encargo tuyo y en
                                tu beneficio, actuando como{' '}
                                <strong className="text-[var(--color-text)]">encargado del tratamiento</strong>.
                                Tu empresa es la responsable de contar con el consentimiento o base legal para
                                tratar los datos de sus propios clientes y trabajadores.
                            </li>
                        </ul>
                    </Section>

                    <Section number="3" title="Qué datos recopilamos">
                        <p><strong className="text-[var(--color-text)]">a) Datos de registro y cuenta.</strong>{' '}
                            Nombre de la empresa, tipo de negocio, nombre completo del administrador, correo
                            electrónico, usuario de acceso y contraseña. Las contraseñas se almacenan siempre
                            cifradas de forma irreversible (hash); nadie en POSVECI puede verlas.
                        </p>
                        <p><strong className="text-[var(--color-text)]">b) Datos operativos del negocio.</strong>{' '}
                            Productos, inventario, ventas, compras, cajas, gastos y proveedores que tu empresa
                            registra para operar.
                        </p>
                        <p><strong className="text-[var(--color-text)]">c) Datos de clientes de tu negocio.</strong>{' '}
                            Si usas el módulo de clientes: nombre, RUT o identificador, datos de contacto y
                            movimientos de crédito («fiado»). Se tratan solo para la operación de tu comercio.
                        </p>
                        <p><strong className="text-[var(--color-text)]">d) Datos de personal.</strong>{' '}
                            Si usas el módulo de personal: nombre, cargo, turnos, asistencia (marcajes de
                            entrada y salida en el kiosco), ausencias y datos laborales asociados.
                        </p>
                        <p><strong className="text-[var(--color-text)]">e) Documentos tributarios.</strong>{' '}
                            Si activas la facturación electrónica, se procesan los datos exigidos por el
                            Servicio de Impuestos Internos de Chile (SII): RUT, razón social, giro, dirección
                            y el detalle de boletas y facturas emitidas.
                        </p>
                        <p><strong className="text-[var(--color-text)]">f) Datos de pago de la suscripción.</strong>{' '}
                            Los pagos del plan se procesan a través de MercadoPago.{' '}
                            <strong className="text-[var(--color-text)]">POSVECI no almacena números de tarjeta</strong>{' '}
                            ni credenciales bancarias; solo recibimos la confirmación del pago y el estado de
                            la suscripción.
                        </p>
                        <p><strong className="text-[var(--color-text)]">g) Datos técnicos.</strong>{' '}
                            Cookies de sesión, registros técnicos de acceso y datos almacenados localmente en
                            tu dispositivo para que el sistema funcione sin internet (ver secciones 7 y 8).
                        </p>
                    </Section>

                    <Section number="4" title="Para qué usamos los datos">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Crear y administrar tu cuenta, autenticarte y mantener tu sesión segura.</li>
                            <li>Prestar las funciones del sistema: ventas, inventario, reportes, personal, clientes y facturación.</li>
                            <li>Emitir documentos tributarios electrónicos ante el SII cuando tu empresa lo solicita.</li>
                            <li>Procesar el cobro de tu suscripción y gestionar el estado de tu plan.</li>
                            <li>Sincronizar pedidos de tu tienda web (por ejemplo, integraciones con WooCommerce o MiniVeci) cuando las activas.</li>
                            <li>Darte soporte técnico y comunicarte información relevante del servicio.</li>
                            <li>Mejorar la Plataforma a partir de métricas de uso agregadas, nunca vendiendo tus datos.</li>
                        </ul>
                        <p>
                            <strong className="text-[var(--color-text)]">POSVECI no vende, alquila ni cede tus datos
                            ni los de tus clientes a terceros con fines comerciales o publicitarios.</strong>
                        </p>
                    </Section>

                    <Section number="5" title="Con quién compartimos datos">
                        <p>Solo compartimos datos con proveedores estrictamente necesarios para operar el servicio:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong className="text-[var(--color-text)]">Infraestructura y base de datos:</strong> proveedores de nube donde se aloja la aplicación y la base de datos (actualmente Vercel y Turso, con servidores en Estados Unidos).</li>
                            <li><strong className="text-[var(--color-text)]">Pagos:</strong> MercadoPago, para el cobro de suscripciones.</li>
                            <li><strong className="text-[var(--color-text)]">Servicio de Impuestos Internos (SII):</strong> cuando tu empresa emite documentos tributarios electrónicos, exigido por ley.</li>
                            <li><strong className="text-[var(--color-text)]">Integraciones que tú actives:</strong> como tu tienda web (WooCommerce / MiniVeci); solo se intercambian los datos del pedido.</li>
                        </ul>
                        <p>
                            Estos proveedores procesan los datos bajo sus propias medidas de seguridad y solo
                            para prestar el servicio contratado. Al usar la Plataforma consientes esta
                            transferencia internacional de datos, resguardada mediante cifrado y controles de acceso.
                        </p>
                        <p>
                            Podremos divulgar información si una ley, tribunal o autoridad competente lo exige.
                        </p>
                    </Section>

                    <Section number="6" title="Cómo protegemos tus datos">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Cifrado de todas las comunicaciones mediante HTTPS/TLS.</li>
                            <li>Contraseñas almacenadas con hash criptográfico (bcrypt), nunca en texto plano.</li>
                            <li>Sesiones firmadas en cookies httpOnly, inaccesibles para scripts de terceros.</li>
                            <li>Validación de identidad y permisos en el servidor para cada operación sensible.</li>
                            <li>Control de acceso por roles: cada usuario de tu empresa ve solo lo que su rol permite.</li>
                            <li>Separación de datos por empresa: cada cuenta accede exclusivamente a su propia información.</li>
                        </ul>
                        <p>
                            Ningún sistema es infalible; si detectamos un incidente de seguridad que afecte tus
                            datos personales, te lo notificaremos a la brevedad junto con las medidas adoptadas.
                        </p>
                    </Section>

                    <Section number="7" title="Cookies y sesión">
                        <p>
                            Usamos cookies estrictamente funcionales: principalmente una cookie de sesión
                            (firmada digitalmente) que te mantiene autenticado por un período limitado.
                            No usamos cookies de publicidad ni rastreadores de terceros. Puedes borrar las
                            cookies desde tu navegador; al hacerlo se cerrará tu sesión.
                        </p>
                    </Section>

                    <Section number="8" title="Almacenamiento local y modo sin conexión">
                        <p>
                            Para que tu punto de venta siga funcionando sin internet, la Plataforma guarda una
                            copia de trabajo de tu catálogo y ventas pendientes en el almacenamiento local del
                            dispositivo (tecnología del propio navegador). Esa información se sincroniza con el
                            servidor al recuperar la conexión y queda limitada al dispositivo que usas; te
                            recomendamos proteger tus equipos con sesión de usuario y bloqueo de pantalla.
                        </p>
                    </Section>

                    <Section number="9" title="Conservación y eliminación">
                        <p>
                            Conservamos los datos mientras tu cuenta esté activa o mientras sean necesarios para
                            prestarte el servicio. Los documentos tributarios se conservan por los plazos que
                            exige la normativa chilena. Si cierras tu cuenta, puedes solicitar la eliminación de
                            los datos de tu empresa; los eliminaremos o anonimizaremos dentro de un plazo
                            razonable, salvo aquellos que debamos retener por obligación legal.
                        </p>
                    </Section>

                    <Section number="10" title="Tus derechos">
                        <p>
                            De acuerdo con la Ley N° 19.628 sobre Protección de la Vida Privada y la Ley
                            N° 21.719 de Protección de Datos Personales de Chile, tienes derecho a:
                        </p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong className="text-[var(--color-text)]">Acceso:</strong> saber qué datos tuyos tratamos.</li>
                            <li><strong className="text-[var(--color-text)]">Rectificación:</strong> corregir datos inexactos o desactualizados.</li>
                            <li><strong className="text-[var(--color-text)]">Supresión:</strong> pedir la eliminación de tus datos cuando corresponda.</li>
                            <li><strong className="text-[var(--color-text)]">Oposición y portabilidad:</strong> oponerte a ciertos tratamientos y solicitar tus datos en un formato reutilizable.</li>
                        </ul>
                        <p>
                            Puedes ejercer estos derechos escribiendo a{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--color-primary)] hover:underline">{CONTACT_EMAIL}</a>{' '}
                            o desde el módulo de Soporte dentro de la aplicación. Si eres cliente o trabajador
                            de un comercio que usa POSVECI, dirige tu solicitud primero a ese comercio
                            (responsable de tus datos); colaboraremos con él para responderla.
                        </p>
                    </Section>

                    <Section number="11" title="Menores de edad">
                        <p>
                            POSVECI es una herramienta de trabajo dirigida a empresas y mayores de 18 años.
                            No recopilamos deliberadamente datos de menores de edad.
                        </p>
                    </Section>

                    <Section number="12" title="Cambios a esta política">
                        <p>
                            Podemos actualizar esta política para reflejar cambios del servicio o de la
                            normativa. Publicaremos la versión vigente en esta página indicando la fecha de
                            última actualización y, si el cambio es sustancial, te lo avisaremos dentro de la
                            Plataforma o por correo antes de que entre en vigencia.
                        </p>
                    </Section>

                    <Section number="13" title="Contacto">
                        <p>
                            Si tienes dudas sobre esta política o sobre el tratamiento de tus datos, escríbenos a{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--color-primary)] hover:underline">{CONTACT_EMAIL}</a>.
                        </p>
                    </Section>
                </div>

                <p className="text-center text-xs text-[var(--color-text-muted)] mt-6">
                    © {new Date().getFullYear()} POSVECI · Todos los derechos reservados
                </p>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
