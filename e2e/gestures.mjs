/** Real pointer down/up; assertion runs while the momentary contact is held. */
export async function pressAndHold(page, actuator, whileHeld) {
  await actuator.hover(); const box = await actuator.boundingBox();
  if (!box) throw new Error('Actuator is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try { await whileHeld(); } finally { await page.mouse.up(); }
}
