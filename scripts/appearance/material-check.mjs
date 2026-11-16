import assert from 'node:assert/strict';

export async function checkTableMaterials({evaluate,run}) {
  await run('Table controls consume theme materials and preserve low-health meaning',async()=>{
    const result=await evaluate(`(async () => {
      const root=document.documentElement;
      const fields=[
        ['--material-send-wash','.cine-send','backgroundColor','#123456','rgb(18, 52, 86)'],
        ['--material-send-edge','.cine-send','borderTopColor','#abcdef','rgb(171, 205, 239)'],
        ['--material-chosen-wash','.cine-desk .session-mode[data-on]','backgroundColor','#654321','rgb(101, 67, 33)'],
        ['--material-vital-fill','.cine-party-fill:not([data-low="true"])','backgroundColor','#135724','rgb(19, 87, 36)'],
      ];
      const fill=document.querySelector('.cine-party-fill');
      if(!fill) throw new Error('Fixture needs a party health bar');
      const lowAttribute=fill.getAttribute('data-low');
      fill.setAttribute('data-low','true');
      const lowBefore=getComputedStyle(fill).backgroundImage;
      const oldVital=root.style.getPropertyValue('--material-vital-fill');
      root.style.setProperty('--material-vital-fill','#135724');
      const lowAfter=getComputedStyle(fill).backgroundImage;
      if(oldVital) root.style.setProperty('--material-vital-fill',oldVital);else root.style.removeProperty('--material-vital-fill');
      if(lowAttribute===null) fill.removeAttribute('data-low');else fill.setAttribute('data-low',lowAttribute);
      const checks=[];
      for(const [variable,selector,property,value,expected] of fields) {
        const element=document.querySelector(selector);
        if(!element) throw new Error('Missing material surface: '+selector);
        const previous=root.style.getPropertyValue(variable);
        try {
          root.style.setProperty(variable,value);
          // The motion kit paints the chosen button's fill on a travelling
          // indicator. A layout event makes it sample the new theme material.
          window.dispatchEvent(new Event('resize'));
          await new Promise(requestAnimationFrame);
          const surface=variable==='--material-chosen-wash' ? element.closest('[data-pill-ready]')?.querySelector('.motion-pill')??element : element;
          // Flush the color transition before waiting for its final state.
          getComputedStyle(surface)[property];
          await Promise.all(surface.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
          const style=getComputedStyle(surface);
          checks.push({variable,actual:style[property],expected,image:style.backgroundImage});
        } finally {
          if(previous) root.style.setProperty(variable,previous);else root.style.removeProperty(variable);
          window.dispatchEvent(new Event('resize'));
          await new Promise(requestAnimationFrame);
        }
      }
      return {checks,lowBefore,lowAfter};
    })()`);
    for(const check of result.checks) {
      assert.equal(check.actual,check.expected,check.variable+' controls its surface: '+JSON.stringify(check));
      if(check.variable!=='--material-send-edge') assert.equal(check.image,'none',check.variable+' replaces the old gradient');
    }
    assert.equal(result.lowAfter,result.lowBefore,'Low health retains its semantic color');
    return result;
  });
}
