/**
 * Помощь, шутки, лента, статистика и присутствие — в настоящем Chrome на реальном backend.
 *   cd e2e && npm i && npm run social
 */
import { api, assert, createRoom, joinRoom, launchChrome, openUser, shot, startStack, step, summary, until } from './lib.mjs';

const env = await startStack({ backendPort: 8798, webPort: 4598 });
const browser = await launchChrome();
const [lotti, anya, borya] = await Promise.all(['Лотти', 'Аня', 'Боря'].map((n) => openUser(browser, env, n)));
let roomId;

const roomPhase = async () => (await api(env, lotti, 'GET', `/api/rooms/${roomId}`)).body.room.phase;
const social = (u) => u.page.getByTestId('social-panel');
const actionBtn = (u, targetName, label) => u.page.getByRole('button', { name: new RegExp(`^${label} — ${targetName}`) });

console.log('\nПомощь, шутки, статистика');
try {
  await step('трое заходят в комнату через интерфейс', async () => {
    const code = await createRoom(lotti, env);
    await joinRoom(anya, env, code);
    await joinRoom(borya, env, code);
    roomId = (await api(env, lotti, 'GET', `/api/rooms/${code}`)).body.room.id;
    for (const u of [lotti, anya, borya]) u.id = (await api(env, u, 'GET', '/api/users/me')).body.id;
    // ускоренная демо-комната: фокус 6 с, перерыв 2 мин (меняет хост до старта, как в настройках)
    const s = await api(env, lotti, 'PATCH', `/api/rooms/${roomId}/settings`, { focusSeconds: 6, breakSeconds: 120 });
    assert(s.status === 200, `настройки: ${JSON.stringify(s.body)}`);
  });

  await step('до перерыва действия заблокированы и это объяснено', async () => {
    await anya.page.getByTestId('open-social').click();
    await social(anya).waitFor();
    assert((await anya.page.getByTestId('social-phase-note').textContent()).includes('откроются на перерыве'), 'нет пояснения');
    const btns = social(anya).locator('button[data-action]');
    assert((await btns.count()) === 8, 'должно быть 4 действия × 2 друга');
    for (let i = 0; i < 8; i++) assert(await btns.nth(i).isDisabled(), 'кнопка действия активна вне перерыва');
  });

  await step('в фокусе шутки не проходят ни через интерфейс, ни через API', async () => {
    // хост запускает фокус, когда все участники в сети нажали «Я готов»
    // (у Ани открыта панель «Друзья» — она закрывает кнопки таймера, поэтому сначала возвращаемся к таймеру)
    await anya.page.getByTestId('open-social').click();
    for (const u of [lotti, anya, borya]) await u.page.getByRole('button', { name: 'Я готов' }).click();
    await until(async () => lotti.page.getByRole('button', { name: 'Начать фокус' }).isEnabled(), { msg: '«Начать фокус» не активировалась после готовности всех' });
    await lotti.page.getByRole('button', { name: 'Начать фокус' }).click();
    await anya.page.getByTestId('open-social').click();
    await social(anya).waitFor();
    await until(async () => (await roomPhase()) === 'focus', { msg: 'фокус не начался' });
    const r = await api(env, borya, 'POST', `/api/rooms/${roomId}/social/prank`, { targetUserId: anya.id, type: 'fog' });
    assert(r.status === 409, `сервер пропустил шутку в фокусе: ${r.status}`);
    assert((await anya.page.getByTestId('prank-fog').count()) === 0, 'туман в фокусе');
    assert(await social(anya).locator('button[data-action="fog"]').first().isDisabled(), 'кнопка шутки активна в фокусе');
  });

  await step('перерыв сам открывает игру; Лотти даёт Ане бонус — у Ани эффект появляется сразу', async () => {
    await until(async () => (await roomPhase()) === 'break', { timeout: 20_000, msg: 'перерыв не наступил' });
    // перерыв не пустой: у всех сразу открыта игра (Tower Defense)
    for (const u of [lotti, anya, borya]) await until(async () => (await u.page.getByRole('region', { name: 'Tower Defense' }).count()) > 0, { msg: `${u.name}: игра не открылась на перерыве` });
    for (const u of [lotti, anya, borya]) { await u.page.getByTestId('open-social').click(); await social(u).waitFor(); }
    // «Друзья» — список людей комнаты, сгруппированный по командам
    assert((await social(lotti).locator('[data-member]').count()) === 3, 'в списке не все участники комнаты');
    await until(async () => actionBtn(lotti, 'Аня', 'Бонус к XP').isEnabled(), { msg: 'кнопка бонуса не активировалась на перерыве' });
    await actionBtn(lotti, 'Аня', 'Бонус к XP').click();
    await until(async () => ((await anya.page.getByTestId('my-effects').textContent()) ?? '').includes('бонус к XP'), { msg: 'эффект у получателя не обновился' });
    assert(await actionBtn(lotti, 'Аня', 'Бонус к XP').isDisabled(), 'повторный бонус в тот же перерыв не заблокирован');
  });

  await step('шутка «туман» видна получателю, подписана и убирается одним нажатием', async () => {
    await actionBtn(lotti, 'Аня', 'Туман').click();
    await anya.page.getByTestId('prank-fog').waitFor({ timeout: 5000 });
    await anya.page.waitForTimeout(700);
    await shot(anya, 'prank-fog.png');
    // таймер не прячется под панелью: он уехал вверх и не пересекается с содержимым
    const timer = await anya.page.getByRole('timer').boundingBox();
    const panelBox = await social(anya).boundingBox();
    assert(timer && panelBox && timer.y + timer.height <= panelBox.y + 4, `таймер наезжает на панель (${timer?.y}+${timer?.height} > ${panelBox?.y})`);
    const pill = await anya.page.getByRole('status').filter({ hasText: 'Туман от' }).boundingBox();
    assert(pill && pill.y > timer.y + timer.height, 'плашка шутки перекрывает таймер');
    await until(async () => (await anya.page.getByRole('status').filter({ hasText: 'Туман от Лотти' }).count()) > 0, { msg: 'нет подписи, от кого шутка' });
    await anya.page.getByTestId('prank-dismiss').first().click();
    await until(async () => (await anya.page.getByTestId('prank-fog').count()) === 0, { msg: 'туман не убрался' });
  });

  await step('липучка от Бори видна Ане', async () => {
    await until(async () => actionBtn(borya, 'Аня', 'Липучка').isEnabled(), { msg: 'кнопка липучки недоступна' });
    await actionBtn(borya, 'Аня', 'Липучка').click();
    await anya.page.getByTestId('prank-sticker').waitFor({ timeout: 5000 });
    await shot(anya, 'prank-sticker.png');
  });

  await step('Аня отключает шутки в профиле (§5.5): сервер не пропускает шутку в неё', async () => {
    await api(env, anya, 'PATCH', '/api/users/me', { prankEnabled: false });
    const r = await api(env, borya, 'POST', `/api/rooms/${roomId}/social/prank`, { targetUserId: anya.id, type: 'fog' });
    assert(r.status === 409 && r.body.error.code === 'PRANKS_DISABLED', `сервер: ${JSON.stringify(r.body)}`);
    assert((await api(env, anya, 'GET', '/api/users/me')).body.prankEnabled === false, 'настройка не сохранилась');
  });

  await step('статистика: сессии, время концентрации, уровень, достижения и командный прогресс из backend', async () => {
    await lotti.page.getByTestId('open-stats').click();
    await lotti.page.getByTestId('stats-panel').waitFor();
    await until(async () => (await lotti.page.getByTestId('stats-sessions').textContent()) === '1', { msg: 'сессий не 1' });
    assert((await lotti.page.getByTestId('stats-focus').textContent()) === '6 с', 'время концентрации не 6 с');
    const me = (await api(env, lotti, 'GET', '/api/users/me/stats')).body;
    assert((await lotti.page.getByTestId('stats-level').textContent()) === `Уровень ${me.level}`, 'уровень расходится с backend');
    assert((await lotti.page.getByTestId('stats-achievements').textContent()) === `${me.achievements.unlocked} из ${me.achievements.total}`, 'достижения расходятся с backend');
    assert(me.achievements.unlocked >= 2, 'за сессию и помощь должны быть достижения');
    assert((await lotti.page.locator('[data-achievement="helper"]').getAttribute('data-unlocked')) === 'true', 'достижение «Друг познаётся» не показано');
    // Tower Wars: карту двигают только победы в TD (0 / 4 после одного цикла), очки вклада и казна — отдельно
    const rs = (await api(env, lotti, 'GET', `/api/rooms/${roomId}/stats`)).body;
    assert((await lotti.page.getByTestId('team-points-shared').textContent()) === `карта: ${rs.teams[0].points} / ${rs.goal}`, 'прогресс команды по карте');
    assert(rs.teams[0].focusPoints === 3, `очки вклада команды: ${rs.teams[0].focusPoints}`);
    assert((await lotti.page.locator('[data-team="shared"] tbody tr').count()) === 3, 'в таблице вклада не 3 участника');
    const bar = await lotti.page.locator('[data-day-bar="6"]').boundingBox();
    assert(bar && bar.height > 40, `столбик сегодняшнего дня не нарисован (высота ${bar?.height})`);
    await lotti.page.waitForTimeout(800); // дождаться конца анимации раскрытия
    await shot(lotti, 'stats.png');
  });

  await step('присутствие: Боря закрыл вкладку — у остальных его точка становится «переподключается»', async () => {
    await borya.context.close();
    const dot = lotti.page.locator(`[data-member-avatar="${borya.id}"]`);
    await until(async () => (await dot.getAttribute('data-connection')) !== 'online', { timeout: 30_000, msg: 'точка онлайна не обновилась без перезагрузки' });
  });

  await step('в консоли браузеров нет ошибок', async () => {
    const all = [lotti, anya].flatMap((u) => u.errors.map((e) => `${u.name}: ${e}`));
    assert(all.length === 0, all.join('\n'));
  });
} finally {
  await browser.close();
  await env.stop();
}
process.exit(summary('Соцмеханики и статистика') ? 0 : 1);
