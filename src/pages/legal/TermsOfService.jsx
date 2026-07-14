import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ScrollText } from 'lucide-react';

// Términos de Servicio públicos (/terminos). Se enlazan desde el registro.
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

const TermsOfService = () => {
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
                            <ScrollText size={24} className="text-white" />
                        </div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[var(--color-text)]">
                            Términos de Servicio de POSVECI
                        </h1>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            Última actualización: {LAST_UPDATE}
                        </p>
                        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                            Estos Términos regulan el uso de POSVECI («la Plataforma»), el sistema de punto
                            de venta y gestión comercial en la nube. Al crear una cuenta, iniciar la prueba
                            gratuita o contratar un plan, declaras haber leído y aceptado estos Términos y la{' '}
                            <a href="/privacidad" className="text-[var(--color-primary)] hover:underline">Política de Privacidad</a>.
                            Si no estás de acuerdo, no debes usar la Plataforma.
                        </p>
                    </header>

                    <Section number="1" title="El servicio">
                        <p>
                            POSVECI es un software como servicio (SaaS) que permite a comercios gestionar
                            ventas, inventario, caja, clientes, proveedores, personal y asistencia, finanzas,
                            emisión de documentos tributarios electrónicos ante el SII de Chile y venta web,
                            según el plan contratado. La Plataforma incluye un modo sin conexión que permite
                            seguir vendiendo ante cortes de internet y sincroniza los datos al recuperarla.
                        </p>
                        <p>
                            Las funcionalidades disponibles dependen del plan vigente de tu cuenta. Podemos
                            agregar, modificar o retirar funciones para mejorar el servicio; si un cambio
                            reduce de forma sustancial una función esencial de tu plan, te lo comunicaremos
                            con anticipación razonable.
                        </p>
                    </Section>

                    <Section number="2" title="Cuenta y registro">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Debes ser mayor de 18 años y entregar información veraz y actualizada al registrarte.</li>
                            <li>La cuenta se crea a nombre de una empresa o negocio; el administrador que la registra declara estar facultado para representarla.</li>
                            <li>Eres responsable de la confidencialidad de tus credenciales y de todo lo que ocurra bajo tu cuenta y las cuentas de usuario que crees para tu equipo.</li>
                            <li>Debes avisarnos de inmediato ante cualquier uso no autorizado de tu cuenta.</li>
                        </ul>
                    </Section>

                    <Section number="3" title="Prueba gratuita">
                        <p>
                            Las cuentas nuevas incluyen un período de prueba gratuito (actualmente 30 días)
                            con acceso a las funciones del sistema, sin requerir tarjeta de crédito. Al
                            terminar la prueba, el acceso queda limitado hasta que contrates un plan. Los
                            datos que registraste durante la prueba se conservan por un período razonable para
                            que puedas continuar donde quedaste al contratar.
                        </p>
                        <p>
                            La prueba gratuita es por empresa y por única vez; nos reservamos el derecho de
                            cancelar pruebas duplicadas o fraudulentas.
                        </p>
                    </Section>

                    <Section number="4" title="Planes, precios y pago">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Los planes vigentes (por ejemplo Básico, Medium y Pro), sus funciones y precios son los publicados en la Plataforma al momento de contratar.</li>
                            <li>El pago se procesa a través de MercadoPago, según el ciclo elegido (por ejemplo mensual o anual). POSVECI no almacena datos de tarjetas.</li>
                            <li>Los precios pueden actualizarse; los cambios se aplican a partir del siguiente ciclo de facturación y se informan con anticipación.</li>
                            <li>Los impuestos aplicables se rigen por la normativa del país de facturación.</li>
                        </ul>
                    </Section>

                    <Section number="5" title="Renovación, mora y suspensión">
                        <p>
                            Cada plan otorga acceso hasta la fecha de término del ciclo pagado. Si el pago de
                            renovación no se realiza, la cuenta puede pasar a un estado de gracia y luego
                            suspenderse: el acceso a la operación se bloquea, pero tus datos se conservan.
                            Al regularizar el pago, el acceso se restablece con tu información intacta.
                        </p>
                        <p>
                            Podemos suspender o cancelar una cuenta que incumpla estos Términos, haga un uso
                            abusivo o ilícito de la Plataforma, o afecte la seguridad o estabilidad del servicio.
                        </p>
                    </Section>

                    <Section number="6" title="Tus datos y tus obligaciones como comercio">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Los datos que cargas (productos, ventas, clientes, personal) son y siguen siendo de tu empresa. POSVECI los procesa por encargo tuyo, según la <a href="/privacidad" className="text-[var(--color-primary)] hover:underline">Política de Privacidad</a>.</li>
                            <li>Eres responsable de la exactitud de la información que registras y de contar con base legal para tratar los datos de tus clientes y trabajadores.</li>
                            <li>El cumplimiento tributario es tuyo: POSVECI es una herramienta para emitir y gestionar documentos, pero la responsabilidad ante el SII (folios, declaraciones, plazos) corresponde a tu empresa.</li>
                            <li>Te comprometes a usar la Plataforma conforme a la ley y a no registrar operaciones simuladas o fraudulentas.</li>
                        </ul>
                    </Section>

                    <Section number="7" title="Uso aceptable">
                        <p>No está permitido:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Intentar acceder a datos de otras empresas o a áreas del sistema no autorizadas.</li>
                            <li>Realizar ingeniería inversa, copiar o revender la Plataforma sin autorización escrita.</li>
                            <li>Sobrecargar o interferir deliberadamente con el servicio, ni usar bots o scraping no autorizado.</li>
                            <li>Usar la Plataforma para actividades ilícitas o para almacenar contenido ilegal.</li>
                        </ul>
                    </Section>

                    <Section number="8" title="Disponibilidad del servicio">
                        <p>
                            Trabajamos para mantener la Plataforma disponible de forma continua, con
                            infraestructura en la nube y modo sin conexión como respaldo operativo. Sin
                            embargo, el servicio se presta «tal cual» y puede experimentar interrupciones por
                            mantenimiento, fallas de proveedores externos (hosting, base de datos, pasarela de
                            pago, SII) o causas de fuerza mayor. Realizamos mantenciones procurando el menor
                            impacto posible.
                        </p>
                    </Section>

                    <Section number="9" title="Propiedad intelectual">
                        <p>
                            La Plataforma, su código, diseño, marcas y documentación son propiedad de POSVECI.
                            La contratación de un plan otorga una licencia de uso limitada, no exclusiva e
                            intransferible mientras la suscripción esté vigente; no transfiere ningún derecho
                            de propiedad sobre el software.
                        </p>
                    </Section>

                    <Section number="10" title="Limitación de responsabilidad">
                        <p>
                            En la máxima medida permitida por la ley, POSVECI no será responsable por daños
                            indirectos, lucro cesante o pérdida de datos causados por caso fortuito, fuerza
                            mayor, fallas de terceros o uso indebido de la Plataforma. Nuestra responsabilidad
                            total frente a un reclamo se limita al monto pagado por tu empresa en los tres
                            meses anteriores al hecho que lo origina.
                        </p>
                        <p>
                            Nada en estos Términos limita responsabilidades que la ley no permita limitar.
                        </p>
                    </Section>

                    <Section number="11" title="Cancelación y término">
                        <ul className="list-disc pl-5 space-y-2">
                            <li>Puedes dejar de usar el servicio y no renovar tu plan en cualquier momento; el acceso se mantiene hasta el final del ciclo ya pagado.</li>
                            <li>Al cerrar tu cuenta puedes solicitar la exportación o eliminación de los datos de tu empresa, conforme a la Política de Privacidad.</li>
                            <li>Los montos ya pagados por ciclos iniciados no son reembolsables, salvo que la ley disponga lo contrario.</li>
                        </ul>
                    </Section>

                    <Section number="12" title="Cambios a estos Términos">
                        <p>
                            Podemos actualizar estos Términos para reflejar cambios del servicio o de la
                            normativa. Publicaremos la versión vigente en esta página con su fecha de
                            actualización y, si el cambio es sustancial, lo avisaremos dentro de la Plataforma
                            o por correo antes de que entre en vigencia. El uso continuado del servicio tras
                            la entrada en vigencia implica aceptación de los nuevos Términos.
                        </p>
                    </Section>

                    <Section number="13" title="Ley aplicable y contacto">
                        <p>
                            Estos Términos se rigen por las leyes de la República de Chile. Cualquier
                            controversia se someterá a los tribunales competentes del domicilio del proveedor,
                            sin perjuicio de los derechos irrenunciables del consumidor.
                        </p>
                        <p>
                            Dudas o solicitudes:{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--color-primary)] hover:underline">{CONTACT_EMAIL}</a>{' '}
                            o el módulo de Soporte dentro de la aplicación.
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

export default TermsOfService;
