//Attach a listener for cursor movement
Hooks.on('ready', function() {
  window.onmousemove = checkTooltipMove;
});

//
Hooks.on("renderActorSheet", (html) => {
  var actorId = html.id.split("-")[1];
  var actor = game.actors.get(actorId);

  $(".item .rollable").on({
    mouseenter: function () {
      checkForTooltip(this, actor);
    },
    mouseleave:function () {
      removeTooltip();
    }
  });
});

//
function checkTooltipMove(e) {
  mousePos = { x: e.clientX, y: e.clientY };
  
  var tooltip = $(".diceinfo-tooltip");
  if (tooltip.length == 0) return;

  tooltip.css('top', (e.clientY - 24 - tooltip.height()/2) + 'px');
  tooltip.css('left', (e.clientX + 1) + 'px');
}

function checkForTooltip(el, actor) {
  var dataItem = $(el).closest("li").get();
  var data = dataItem[0].dataset;
  let item = actor.getOwnedItem(data.itemId);
  
  let tooltipStr = "";
  let createTooltip = false;
  
  if (item.hasAttack) {
    createTooltip = true;
    tooltipStr += "<p><b>• Attack: </b>" + formatDiceParts(rollFakeAttack(item)) + '</p>';
  }

  if (item.hasDamage) {
    createTooltip = true;
    const itemConfig = {
      // spellLevel: 3,
      versatile: item.isVersatile
    };
    var dmgOrHealing = item.isHealing? "Healing" : "Damage";
    tooltipStr += "<p><b>• " + dmgOrHealing + ": </b>" + formatDiceParts(rollFakeDamage(item, itemConfig)) + " " + item.labels.damageTypes + "</p>";
  }

  if (item.hasSave) {
    createTooltip = true;
    tooltipStr += "<p><b>• Save: </b>" + item.labels.save + "</p>";
  }

  if (!createTooltip) return;
  
  var template = '<div class="diceinfo-tooltip"><span><div class="arrow-left"></div><div class="tooltiptext">' + tooltipStr + '</div></span></div>';
  $("body").append(template);
}

//
function removeTooltip() {
  $(".diceinfo-tooltip").remove();
}

function formatDiceParts(rollData) {
  var res = "";
  var bonusStr = "";

  if (rollData.parts.length > 0) {
    for (var i=0;i<rollData.parts.length;i++) {
      if (typeof rollData.parts[i] == 'object') {
        if (i > 0) res += " + ";
        res += rollData.parts[i].formula;
      } else {
        bonusStr += rollData.parts[i];
      }
    }
  } else {
    bonusStr = rollData.formula;
  }
  
  try {
    var bonusVal = eval(bonusStr)
    if (res.length > 0) res += " + ";
    if (bonusVal != 0) res += bonusVal;
  } catch (e) {
    if (res.length > 0) res += " + ";
    res += bonusStr;
  }

  return res;
}

/* -------------------------------------------- */
/*  Item Rolls - Attack, Damage, Saves, Checks  */
/* -------------------------------------------- */

function rollFakeAttack(item) {
  const itemData = item.data.data;
  const actorData = item.actor.data.data;
  const flags = item.actor.data.flags.dnd5e || {};
  if ( !item.hasAttack ) {
    throw new Error("You may not place an Attack Roll with this Item.");
  }
  const rollData = item.getRollData();

  // Define Roll bonuses
  const parts = [`@mod`];
  if ( (item.data.type !== "weapon") || itemData.proficient ) {
    parts.push("@prof");
  }

  // Attack Bonus
  const actorBonus = actorData.bonuses[itemData.actionType] || {};
  if ( itemData.attackBonus || actorBonus.attack ) {
    parts.push("@atk");
    rollData["atk"] = [itemData.attackBonus, actorBonus.attack].filterJoin(" + ");
  }

  // Compose roll options
  const rollConfig = {
    parts: parts,
    actor: item.actor,
    data: rollData,
    title: `${item.name} - Attack Roll`
  };

  // Expanded weapon critical threshold
  if (( item.data.type === "weapon" ) && flags.weaponCriticalThreshold) {
    rollConfig.critical = parseInt(flags.weaponCriticalThreshold);
  }

  // Elven Accuracy
  if ( ["weapon", "spell"].includes(item.data.type) ) {
    if (flags.elvenAccuracy && ["dex", "int", "wis", "cha"].includes(item.abilityMod)) {
      rollConfig.elvenAccuracy = true;
    }
  }

  // Apply Halfling Lucky
  if ( flags.halflingLucky ) rollConfig.halflingLucky = true;

  // Invoke the d20 roll helper
  return d20RollFake(rollConfig);
}

  /* -------------------------------------------- */

function rollFakeDamage(item, {spellLevel=null, versatile=false}={}) {
  const itemData = item.data.data;
  const actorData = item.actor.data.data;
  if ( !item.hasDamage ) {
    throw new Error("You may not make a Damage Roll with this Item.");
  }
  const rollData = item.getRollData();
  if ( spellLevel ) rollData.item.level = spellLevel;

  // Define Roll parts
  const parts = itemData.damage.parts.map(d => d[0]);
  if ( versatile && itemData.damage.versatile ) parts[0] = itemData.damage.versatile;
  if ( (item.data.type === "spell") ) {
    if ( (itemData.scaling.mode === "cantrip") ) {
      const lvl = item.actor.data.type === "character" ? actorData.details.level : actorData.details.spellLevel;
      item._scaleCantripDamage(parts, lvl, itemData.scaling.formula );
    } else if ( spellLevel && (itemData.scaling.mode === "level") && itemData.scaling.formula ) {
      item._scaleSpellDamage(parts, itemData.level, spellLevel, itemData.scaling.formula );
    }
  }

  // Define Roll Data
  const actorBonus = actorData.bonuses[itemData.actionType] || {};
  if ( actorBonus.damage && parseInt(actorBonus.damage) !== 0 ) {
    parts.push("@dmg");
    rollData["dmg"] = actorBonus.damage;
  }

  // Call the roll helper utility
  const title = `${item.name} - Damage Roll`;
  const flavor = item.labels.damageTypes.length ? `${title} (${item.labels.damageTypes})` : title;
  return damageRollFake({
    parts: parts,
    actor: item.actor,
    data: rollData,
    title: title,
    flavor: flavor
  });
}

//Dice methods

function d20RollFake({parts=[], data={}, rollMode=null, title=null,
                      flavor=null, advantage=null, disadvantage=null, critical=20, fumble=1, targetValue=null,
                      elvenAccuracy=false, halflingLucky=false}={}) {

  // Handle input arguments
  flavor = flavor || title;
  parts = parts.concat(["@bonus"]);
  rollMode = rollMode || game.settings.get("core", "rollMode");
  let rolled = false;

  // Define inner roll function
  const _roll = function(parts, adv, form=null) {

    // Determine the d20 roll and modifiers
    let nd = 1;
    let mods = halflingLucky ? "r=1" : "";

    // Handle advantage
    if ( adv === 1 ) {
      nd = elvenAccuracy ? 3 : 2;
      flavor += ` (${game.i18n.localize("DND5E.Advantage")})`;
      mods += "kh";
    }

    // Handle disadvantage
    else if ( adv === -1 ) {
      nd = 2;
      flavor += ` (${game.i18n.localize("DND5E.Disadvantage")})`;
      mods += "kl";
    }

    // Include the d20 roll
    parts.unshift(`${nd}d20${mods}`);

    // Optionally include a situational bonus
    if ( form !== null ) data['bonus'] = form.bonus.value;
    if ( !data["bonus"] ) parts.pop();

    // Optionally include an ability score selection (used for tool checks)
    const ability = form ? form.ability : null;
    if ( ability && ability.value ) {
      data.ability = ability.value;
      const abl = data.abilities[data.ability];
      if ( abl ) {
        data.mod = abl.mod;
        flavor += ` (${CONFIG.DND5E.abilities[data.ability]})`;
      }
    }

    // Execute the roll and flag critical thresholds on the d20
    let roll = new Roll(parts.join(" + "), data).roll();
    const d20 = roll.parts[0];
    d20.options.critical = critical;
    d20.options.fumble = fumble;
    if ( targetValue ) d20.options.target = targetValue;
    return roll;
  };

  if ( advantage) return _roll(parts, 1);
  else if ( disadvantage ) return _roll(parts, -1);
  else return _roll(parts, 0);
}

function damageRollFake({parts, actor, data, rollMode=null, template, title, flavor,
                          allowCritical=true, critical=false}) {

  // Handle input arguments
  flavor = flavor || title;
  rollMode = game.settings.get("core", "rollMode");
  let rolled = false;

  // Define inner roll function
  const _roll = function(parts, crit, form) {
    data['bonus'] = form ? form.bonus.value : 0;
    let roll = new Roll(parts.join("+"), data);

    // Modify the damage formula for critical hits
    if ( crit === true ) {
      let add = (actor && actor.getFlag("dnd5e", "savageAttacks")) ? 1 : 0;
      let mult = 2;
      roll.alter(add, mult);
      flavor = `${flavor} (${game.i18n.localize("DND5E.Critical")})`;
    }

    return roll;
  };

  return _roll(parts, critical);
}