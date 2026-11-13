import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heart, Code, Sparkles } from 'lucide-react';
import axolotlImg from '@/assets/axolotl.png';

export default function AboutPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">О сайте</h1>
        </div>

        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <img
                src={axolotlImg}
                alt="Маскот Аксолотль"
                className="w-40 h-40 object-contain"
              />
              <div className="space-y-4 text-center md:text-left">
                <h2 className="text-2xl font-bold">Добро пожаловать в Аксолотль Лаб!</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Этот сайт — демонстрация возможностей CI/CD на практике. Здесь вы можете поиграть в увлекательную
                  кликер-игру с нашим милым маскотом — аксолотлем Лотти
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg gradient-primary">
                  <Code className="h-5 w-5 text-[hsl(155,45%,17%)]" />
                </div>
                <CardTitle className="text-lg">Что вы узнали</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Как все устроено : от кода до деплоя. Теперь вы знаете, как работают пайплайны!
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg gradient-secondary">
                  <Sparkles className="h-5 w-5 text-[hsl(155,45%,17%)]" />
                </div>
                <CardTitle className="text-lg">Игра</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Отдохните и поиграйте в кликер — каждый клик приближает вас к новым достижениям!
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg gradient-primary">
                  <Heart className="h-5 w-5 text-[hsl(155,45%,17%)]" />
                </div>
                <CardTitle className="text-lg">Ваш проект</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Примените знания на практике — создайте свой проект и задеплойте его с CI/CD
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}