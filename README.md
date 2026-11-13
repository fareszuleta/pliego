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

El checkout requiere una membresía activa, utiliza la Visa de demostración terminada en 4242 y confirma el pedido sin procesar cargos. El servidor calcula el total y firma un enlace para descargar las obras seleccionadas. Define MEMBER_SECRET como secreto estable en Render para conservar las confirmaciones cuando cambies la clave del servicio de correo.
