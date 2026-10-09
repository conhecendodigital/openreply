/**
 * 2026-10-06 (fase 0): login novo (senha, Google, link por e-mail), 2FA,
 * Configurações > Segurança e painel do admin.
 */
export const ptAuth: Record<string, string> = {
  // Login
  "Ask for the link by email or use Google. If your email has access, your account is created on the spot.":
    "Peça o link por e-mail ou use o Google. Se o seu e-mail tiver acesso, sua conta é criada na hora.",
  "Continue with Google": "Continuar com o Google",
  Password: "Senha",
  "Sign in": "Entrar",
  "Please wait...": "Aguarde...",
  "No password yet, or forgot it? Sign in with the link and create one in Settings, Security.":
    "Ainda não tem senha ou esqueceu? Entre pelo link do e-mail e crie uma em Configurações, Segurança.",
  "Get a link by email instead": "Prefiro receber um link por e-mail",
  "Sign in with password": "Entrar com senha",
  "If your email has access, the link arrives in a few seconds. It is valid for 15 minutes.":
    "Se o seu e-mail tiver acesso, o link chega em alguns segundos. Ele vale por 15 minutos.",
  // Erros do login
  "Wrong email or password.": "E-mail ou senha errados.",
  "This email does not have access to Lead Engine.": "Este e-mail não tem acesso ao Lead Engine.",
  "Too many tries. Wait a few minutes and try again.": "Muitas tentativas. Espere alguns minutos e tente de novo.",
  "Wrong or expired code. Try again.": "Código errado ou vencido. Tente de novo.",
  "Too many wrong codes. Sign in again in a few minutes.": "Muitos códigos errados. Entre de novo daqui a alguns minutos.",
  "The password needs at least 10 characters.": "A senha precisa ter pelo menos 10 caracteres.",
  "The password is too long.": "A senha está grande demais.",
  "Wrong password.": "Senha errada.",
  "Something went wrong. Try again.": "Algo deu errado. Tente de novo.",
  "This link expired or was already used. Ask for a new one.": "Esse link venceu ou já foi usado. Peça outro.",
  "Google did not confirm this email. Sign in with the link and connect Google in Settings.":
    "O Google não confirmou este e-mail. Entre pelo link e conecte o Google em Configurações.",
  "Could not sign in. Try again.": "Não deu pra entrar. Tente de novo.",
  "The two passwords are different.": "As duas senhas estão diferentes.",
  "You already have a password. Change it in Settings, Security.": "Você já tem senha. Troque em Configurações, Segurança.",
  "Password changed. Your other sessions were closed.": "Senha trocada. As suas outras sessões foram encerradas.",
  // 2FA
  "Two-step verification": "Verificação em duas etapas",
  "Two-step verification - Lead Engine": "Verificação em duas etapas - Lead Engine",
  "Type one of the recovery codes you saved. Each one works only once.":
    "Digite um dos códigos de recuperação que você guardou. Cada um funciona uma vez só.",
  "Open your authenticator app and type the 6 digit code for Lead Engine.":
    "Abra o app autenticador e digite o código de 6 números do Lead Engine.",
  Code: "Código",
  "Recovery code": "Código de recuperação",
  Confirm: "Confirmar",
  "Use the authenticator app": "Usar o app autenticador",
  "Lost your phone? Use a recovery code": "Perdeu o celular? Use um código de recuperação",
  "Download codes": "Baixar os códigos",
  "Copy codes": "Copiar os códigos",
  "Install an authenticator app on your phone (Google Authenticator, Authy or Microsoft Authenticator). After that, every sign in asks for the code that shows up in it.":
    "Instale um app autenticador no celular (Google Authenticator, Authy ou Microsoft Authenticator). Depois disso, todo login pede o código que aparece nele.",
  "Your password": "Sua senha",
  "Turn on two-step verification": "Ligar a verificação em duas etapas",
  "1. In the app, tap to add an account and scan this QR code.": "1. No app, toque pra adicionar uma conta e leia este QR code.",
  "QR code for the authenticator app": "QR code pro app autenticador",
  "Cannot scan? Type this key in the app:": "Não conseguiu ler? Digite esta chave no app:",
  "2. Type the 6 digit code the app shows.": "2. Digite o código de 6 números que o app mostra.",
  "Done! Save these recovery codes somewhere safe. If you lose your phone, each one lets you in once.":
    "Pronto! Guarde estes códigos de recuperação num lugar seguro. Se você perder o celular, cada um deixa você entrar uma vez.",
  "I saved my recovery codes": "Guardei os meus códigos de recuperação",
  Continue: "Continuar",
  "Your account is the Lead Engine admin, so two-step verification is required. Turn it on to continue.":
    "Sua conta é a admin do Lead Engine, então a verificação em duas etapas é obrigatória. Ligue pra continuar.",
  // Criar senha
  "Create your password - Lead Engine": "Crie sua senha - Lead Engine",
  "Create your password": "Crie sua senha",
  "Now you can also sign in with email and password. The link by email keeps working.":
    "Agora você também pode entrar com e-mail e senha. O link por e-mail continua funcionando.",
  "New password": "Nova senha",
  "New password (at least 10 characters)": "Nova senha (pelo menos 10 caracteres)",
  "Repeat the password": "Repita a senha",
  "Create password": "Criar senha",
  "Not now": "Agora não",
  // Configurações > Segurança
  Security: "Segurança",
  "You sign in with the link by email. Create a password to sign in faster.":
    "Você entra pelo link do e-mail. Crie uma senha pra entrar mais rápido.",
  "Current password": "Senha atual",
  "Change password": "Trocar a senha",
  Google: "Google",
  "Connected. You can sign in with Google.": "Conectado. Você pode entrar com o Google.",
  "Connect Google": "Conectar o Google",
  "Off. Turn it on so your password alone is not enough to get in.":
    "Desligada. Ligue pra que só a senha não baste pra entrar.",
  "On. Every sign in asks for the code of your authenticator app.": "Ligada. Todo login pede o código do seu app autenticador.",
  "New recovery codes. The old ones stopped working.": "Códigos de recuperação novos. Os antigos pararam de funcionar.",
  "Generate new recovery codes": "Gerar códigos de recuperação novos",
  "Turn off": "Desligar",
  "As the admin, you cannot turn it off.": "Como você é admin, não dá pra desligar.",
  "Active sessions": "Sessões abertas",
  "Unknown device": "Aparelho desconhecido",
  Browser: "Navegador",
  "This device": "Este aparelho",
  "Sign out": "Sair",
  "Signing out...": "Saindo...",
  "Create account": "Criar conta",
  "Create account - Lead Engine": "Criar conta - Lead Engine",
  "Create your Lead Engine account with an email link or Google.": "Crie sua conta do Lead Engine com um link no e-mail ou com o Google.",
  "Create your account to manage your comments, Direct and contacts.": "Crie sua conta pra cuidar dos seus comentários, Direct e contatos.",
  "1. Type your email and get the link (or use Google).": "1. Digite seu e-mail e receba o link (ou use o Google).",
  "2. Open the link: your account is created on the spot.": "2. Abra o link: sua conta é criada na hora.",
  "3. Create your password in Settings, Security.": "3. Crie sua senha em Configurações, Segurança.",
  "Only emails with access get the link. No access yet? Ask whoever invited you to add your email.": "Só e-mail com acesso recebe o link. Ainda não tem? Peça pra quem te convidou liberar o seu e-mail.",
  "Already have an account?": "Já tem conta?",
  "Sign out of all other devices": "Sair de todos os outros aparelhos",
  "Sign out of this device": "Sair deste aparelho",
  // Admin
  Admin: "Admin",
  "Admin - Lead Engine": "Admin - Lead Engine",
  "Back to the panel": "Voltar pro painel",
  "Beta access": "Acesso ao beta",
  "Only these emails get in, plus ALLOWED_EMAILS and whoever was invited to a workspace. Up to {n} in the beta.":
    "Só entram estes e-mails, mais o ALLOWED_EMAILS e quem foi convidado pra um workspace. Até {n} no beta.",
  "No email on the list yet.": "Nenhum e-mail na lista ainda.",
  "person@email.com": "pessoa@email.com",
  "Note (optional)": "Observação (opcional)",
  Add: "Adicionar",
  Remove: "Remover",
  Users: "Usuários",
  Role: "Papel",
  User: "Usuário",
  Workspaces: "Workspaces",
  On: "Ligada",
  Off: "Desligada",
  "WhatsApp numbers": "Números de WhatsApp",
  "Status and numbers only. Opening a conversation of another workspace is saved in the audit log.":
    "Só status e números. Abrir uma conversa de outro workspace fica gravado no log de auditoria.",
  "Could not read the WhatsApp tables. Check the database roles (docs/fase0-multiusuario.md).":
    "Não deu pra ler as tabelas do WhatsApp. Confira os papéis do banco (docs/fase0-multiusuario.md).",
  "No number connected yet.": "Nenhum número conectado ainda.",
  "{n} conversations": "{n} conversas",
  "{n} messages": "{n} mensagens",
};
