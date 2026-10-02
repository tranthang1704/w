const fs=require('fs');
const p=process.argv[2];
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.version='2.5.16-auto-auction';
j.devDependencies=Object.assign({},j.devDependencies||{},{
  electron:'^38.0.0',
  'electron-builder':'^26.0.12'
});
j.scripts=Object.assign({},j.scripts||{},{
  dist:'electron-builder --win portable --x64'
});
j.build=Object.assign({},j.build||{},{
  appId:'com.anbeo.tranthag.autoauction',
  productName:'TranThagAPPLIVE Auto Auction Full',
  asar:true,
  win:Object.assign({},(j.build&&j.build.win)||{},{
    target:[{target:'portable',arch:['x64']}],
    artifactName:'TranThagAPPLIVE_AutoAuction_FULL.exe'
  })
});
fs.writeFileSync(p,JSON.stringify(j,null,2));
console.log('Prepared package',j.name,j.version);
