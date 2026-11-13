# Pliego Ediciones

Tienda de demostración con carrito y suscripción de prueba. La tarjeta es ficticia y no se realizan cargos.

## Despliegue en Render

Crea un Web Service de Node.js conectado a este repositorio. Usa `npm install` como comando de compilación y `npm start` como comando de inicio.

Configura estas variables en el entorno privado del servicio antes de desplegar.

| Variable | Valor |
| --- | --- |
| RESEND_API_KEY | Clave de envío de tu cuenta de Resend |
| EMAIL_FROM | Remitente de un dominio verificado en Resend |

Al pulsar **Activar**, el servidor envía el mensaje a la dirección introducida mediante Resend. La membresía de prueba se guarda en ese navegador cuando el proveedor acepta el correo. Para comprobar la entrega final, realiza una activación con una dirección propia y consulta la bandeja de entrada o el evento de entrega en Resend.

## Ejecución local

Usa Node.js 22 o posterior. Exporta las dos variables en tu entorno y ejecuta `npm start`. El puerto predeterminado es 3000. Render lo asigna con `PORT`.

## Compras de láminas

Configura STRIPE_SECRET_KEY en las variables privadas de Render. Usa la clave de producción de tu cuenta de Stripe para aceptar pagos reales o su clave de pruebas para validar el recorrido. Render proporciona RENDER_EXTERNAL_URL para el retorno del pago. Puedes definir PUBLIC_URL si utilizas un dominio propio. MEMBER_SECRET permite usar una clave estable para la cookie de membresía, independiente de la clave de correo.

Los precios se calculan en el servidor. El pago único se autoriza en Stripe Checkout y la página de regreso verifica su estado antes de entregar los archivos PNG. El enlace de confirmación es privado y permite recuperar las descargas. El club no factura cuotas automáticamente.
