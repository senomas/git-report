const shell = require("shelljs");
const yaml = require("js-yaml");
const fs = require("fs");

const slack = require("slack-notify")(process.env.SLACK_HOOK);

function tabl(v, col=10) {
  return ("                                       "+String(v)).slice(-col);
}

function tabr(v, col=10) {
  return (String(v)+"                                       ").slice(0, col);
}

const base = ".";
const dates = [{ code: "7d", name: "7 days ago"}, { code: "24h", name: "24 hours ago"}];
const reports = {};

fs.readdirSync(base).forEach(mod => {
  const report = reports[mod] = {};
  let cmdl = `cd ${mod} && git fetch --all`;
  shell.echo(cmdl);
  let proc = shell.exec(cmdl, { silent: true});
  if (proc.code !== 0) {
    shell.echo(`Error: ${cmdl}`);
    shell.exit(1);
  }
  cmdl = `cd ${mod} && git shortlog -sn -e --all`;
  shell.echo(cmdl);
  proc = shell.exec(cmdl, { silent: true});
  if (proc.code !== 0) {
    shell.echo(`Error: ${cmdl}`);
    shell.exit(1);
  }
  proc.stdout.split("\n").forEach(ln => {
    const m = /\s*(\d+)\s+(.*)\s+<(.*@.*)>\s*/g.exec(ln);
    if (m) {
      if (!report[m[3]]) {
        report[m[3]] = {
          name: m[2],
          contribution: {
            commit: parseInt(m[1], 10),
            line: 0
          }
        }
        dates.forEach(dd => {
          report[m[3]][dd.code] = {
            commit: 0,
            line: 0
          };
        });
      } else {
        report[m[3]].contribution.commit += parseInt(m[1], 10);
      }
    }
  });
  cmdl = `cd ${mod} && git ls-files -- . ':!:*.png' | while read f; do git blame --line-porcelain -w -M -C -C "$f" | grep -I '^author-mail '; done | sort -f | uniq -ic | sort -n -r`;
  shell.echo(cmdl);
  proc = shell.exec(cmdl, { silent: true});
  if (proc.code !== 0) {
    shell.echo(`Error: ${cmdl}`);
    shell.exit(1);
  }
  let contributionTotal = 0;
  proc.stdout.split("\n").forEach(ln => {
    const m = /\s*(\d+)\s+author-mail\s+<(.+@.+)>\s*/g.exec(ln);
    if (m) {
      const v = parseInt(m[1], 10);
      report[m[2]].contribution.line = v;
      contributionTotal += v;
    }
  });
  Object.values(report).forEach(ru => {
    ru.contribution.percent = parseInt(ru.contribution.line, 10) * 100 / contributionTotal;
  })
});

dates.forEach(dd => {
  const dk = dd.code;
  const date = dd.name;
  modules.forEach(mod => {
    const report = reports[mod];
    let cmdl = `cd ${mod} && git shortlog -e -sn --all --since="${date}"`;
    shell.echo(cmdl);
    let proc = shell.exec(cmdl, { silent: true});
    if (proc.code !== 0) {
      shell.echo(`Error: ${cmdl}`);
      shell.exit(1);
    }
    proc.stdout.split("\n").forEach(ln => {
      const m = /\s*(\d+)\s+(.*)\s+<(.*@.*)>\s*/g.exec(ln);
      if (m) {
        const rx = report[m[3]];
        cmdl = `cd ${mod} && git log --all --author="${m[3]}" --pretty=tformat: --numstat --since="${date}"`;
        shell.echo(cmdl);
        proc = shell.exec(cmdl, { silent: true});
        if (proc.code !== 0) {
          shell.echo(`Error: ${cmdl}`);
          shell.exit(1);
        }
        const res = proc.stdout.split("\n").reduce((acc, ln) => {
          const lnx = ln.split("\t");
          if (lnx.length === 3) {
            acc += (parseInt(lnx[0], 10) + parseInt(lnx[1], 10));
          }
          return acc;
        }, 0);
        rx[dk] = {
          commit: parseInt(m[1].trim(), 10),
          line: res || 0,
        }
      }
    });
  });
});

Object.entries(reports).forEach(re => {
  const rk = re[0];
  const report = re[1];
  const mrep = {};
  Object.values(report).forEach(uv => {
    if (mrep[uv.name]) {
      mrep[uv.name].contribution.commit += uv.contribution.commit;
      mrep[uv.name].contribution.line += uv.contribution.line;
      mrep[uv.name].contribution.percent += uv.contribution.percent;
      dates.forEach(d => {
        mrep[uv.name][d.code].commit += uv[d.code].commit;
        mrep[uv.name][d.code].line += uv[d.code].line;
      })
    } else {
      mrep[uv.name] = uv;
    }
  })
  reports[rk] = mrep;
});

const logs = [];
logs.push(`Module              Last 24 Hours         Last 7 Days            Contribution`);
logs.push(`   Contributors     Commit      Lines     Commit      Lines      Lines   Percent`);
logs.push(`--------------------------------------------------------------------------------`);
Object.entries(reports).forEach(r => {
  logs.push(`${r[0]}`);
  Object.entries(r[1]).forEach(u => {
    const u24 = u[1]["24h"] || {};
    const u7 = u[1]["7d"] || {};
    logs.push(`   ${tabr(u[0], 16)} ${tabl(u24.commit, 6)} ${tabl(u24.line, 10)} ${tabl(u7.commit, 10)} ${tabl(u7.line, 10)} ${tabl(u[1].contribution.line, 9)} ${tabl(Number(u[1].contribution.percent).toFixed(2), 8)}%`);
  });
})
slack.send({
  channel: '#lumbungdana-dev',
  username: 'Gogs-Statistics',
  icon_url: 'https://gogs.io/img/favicon.ico',
  text: `\`\`\`${logs.join("\n")}\`\`\``
});
